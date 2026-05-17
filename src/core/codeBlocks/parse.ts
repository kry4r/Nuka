// src/core/codeBlocks/parse.ts
//
// Hand-rolled CommonMark-ish fenced code-block parser.
//
// Relation to existing code:
//   - Nuka has no prior code-block helper. The closest thing in the tree
//     is `src/tools/PowerShellTool/*` which strips backticks for shell
//     escape-handling — wholly unrelated to markdown fences.
//   - Upstream (Nuka-Code) does fence parsing via `marked.lexer`, but the
//     entry point (`src/utils/markdown.ts`) is bound to `chalk` / ink /
//     syntax-highlight and the hard exclusions list forbids those. This
//     port is a self-contained alternative — no `marked`, no rendering.
//
// Spec it follows (close-but-not-exact CommonMark §4.5 "Fenced code blocks"):
//   * Fence char is backtick (`) or tilde (~).
//   * Opening fence: ≥3 of the same char, optional ≤3-space indent before,
//     optional info string after (language tag = first whitespace-trimmed
//     word). Backtick fences forbid backticks in the info string;
//     tilde fences allow anything.
//   * Closing fence: ≥ opening length, same char, no info string,
//     optional ≤3-space indent.
//   * A backtick-fenced block may CONTAIN a shorter backtick run, and a
//     tilde-fenced block may contain a shorter tilde run — that's how
//     nested fences are expressed.
//   * Unclosed: consume to EOF, mark `closed = false`.
//
// Indented code blocks (4-space indent) are intentionally NOT supported:
//   they cannot be reliably distinguished from list-item continuations in
//   isolation, and Nuka's callers care about fenced blocks emitted by
//   models. Documented here so the gap is explicit, not accidental.
//
// Side-effects: none. Pure parser.

/** Character that opens/closes a fence. */
export type FenceChar = '`' | '~'

/** One parsed fenced code block. */
export type CodeBlock = {
  /** Info-string language tag (first whitespace-trimmed token), null when absent. */
  lang: string | null
  /** Content between (not including) the opening and closing fences, with original newlines preserved. */
  content: string
  /** 1-based line number of the opening fence in the input text. */
  startLine: number
  /**
   * 1-based line number of the closing fence in the input text. For an
   * unclosed block, this is the last line of the input (EOF).
   */
  endLine: number
  /** Whether a matching closing fence was found. */
  closed: boolean
  /** Backtick (`) or tilde (~). */
  fenceChar: FenceChar
  /** Number of fence chars in the opening fence (≥3). */
  fenceLength: number
  /** 0-based offset in the input of the start of the opening fence line. */
  startOffset: number
  /**
   * 0-based offset in the input of the character JUST AFTER the closing
   * fence line's trailing newline (or input length for EOF / unclosed).
   */
  endOffset: number
}

/** Prose or code segment from `splitByCodeFences`. */
export type Segment =
  | { type: 'prose'; text: string; startLine: number; endLine: number }
  | { type: 'code'; block: CodeBlock }

// Opening fence: ≤3 spaces, then ≥3 of same char, then info string until EOL.
// Capture groups: 1 = indent, 2 = fence run, 3 = info string (raw, untrimmed).
const FENCE_OPEN_RE = /^( {0,3})(`{3,}|~{3,})([^\n]*)$/

// Closing fence: ≤3 spaces, then fence run, then optional trailing whitespace only.
// We parse this manually rather than regex-match because the run-length and
// char must agree with the opener.

/**
 * Try to match an opening fence on a single line (no trailing newline).
 * Returns null if the line is not an opening fence.
 *
 * Backtick info strings cannot contain ` (CommonMark §4.5); tilde fences
 * have no such restriction.
 */
function matchOpenFence(line: string): {
  fenceChar: FenceChar
  fenceLength: number
  info: string
} | null {
  const m = FENCE_OPEN_RE.exec(line)
  if (!m) return null
  const run = m[2]!
  const info = m[3] ?? ''
  const ch = run[0] as FenceChar
  if (ch === '`' && info.includes('`')) return null
  return { fenceChar: ch, fenceLength: run.length, info }
}

/**
 * Is `line` a valid closing fence for a block opened with `openChar` /
 * `openLength`? CommonMark requires same char, length ≥ open length, ≤3
 * indent, no non-whitespace after the run.
 */
function isCloseFence(
  line: string,
  openChar: FenceChar,
  openLength: number,
): boolean {
  // ≤3 leading spaces.
  let i = 0
  while (i < line.length && i < 4 && line[i] === ' ') i++
  if (i === 4) return false // 4-space indent disqualifies.
  // Count run of openChar.
  let runLen = 0
  while (i < line.length && line[i] === openChar) {
    runLen++
    i++
  }
  if (runLen < openLength) return false
  // Trailing must be whitespace only.
  while (i < line.length) {
    const ch = line[i]!
    if (ch !== ' ' && ch !== '\t') return false
    i++
  }
  return true
}

/**
 * Split `text` into lines preserving CRLF/LF distinction so we can
 * reconstruct exact substrings. Each entry is { text, eol, offset } where
 * `text` is the line content (no terminator), `eol` is the terminator
 * ('\n', '\r\n', or '' for the final line if it has no terminator), and
 * `offset` is the 0-based byte offset of the line's first character.
 */
type Line = { text: string; eol: string; offset: number }

function splitLines(text: string): Line[] {
  const out: Line[] = []
  let i = 0
  let lineStart = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === '\n') {
      out.push({
        text: text.slice(lineStart, i),
        eol: '\n',
        offset: lineStart,
      })
      i++
      lineStart = i
    } else if (ch === '\r') {
      const next = text[i + 1]
      if (next === '\n') {
        out.push({
          text: text.slice(lineStart, i),
          eol: '\r\n',
          offset: lineStart,
        })
        i += 2
      } else {
        // Bare CR — treat as line ending too (rare, but parsers should
        // tolerate it; matches Node's readline behaviour).
        out.push({
          text: text.slice(lineStart, i),
          eol: '\r',
          offset: lineStart,
        })
        i++
      }
      lineStart = i
    } else {
      i++
    }
  }
  if (lineStart < text.length || text.length === 0) {
    if (text.length === 0) {
      // Empty input — no lines at all.
    } else {
      out.push({
        text: text.slice(lineStart),
        eol: '',
        offset: lineStart,
      })
    }
  }
  return out
}

/**
 * Parse `text` and return every fenced code block in document order.
 *
 * Empty input yields `[]`. Unclosed blocks are still returned (with
 * `closed: false` and `endLine` set to EOF). Blocks may nest: an outer
 * 4-backtick fence containing a 3-backtick inner survives intact because
 * the inner run is shorter than the opener.
 */
export function extractCodeBlocks(text: string): CodeBlock[] {
  if (text.length === 0) return []
  const lines = splitLines(text)
  const blocks: CodeBlock[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    const open = matchOpenFence(line.text)
    if (!open) {
      i++
      continue
    }
    // Scan for matching close.
    const startLine = i + 1
    const startOffset = line.offset
    const contentStartOffset = line.offset + line.text.length + line.eol.length
    let j = i + 1
    let closed = false
    while (j < lines.length) {
      if (isCloseFence(lines[j]!.text, open.fenceChar, open.fenceLength)) {
        closed = true
        break
      }
      j++
    }
    const lang = open.info.trim().split(/\s+/)[0] ?? ''
    if (closed) {
      const closeLine = lines[j]!
      const content = text.slice(
        contentStartOffset,
        closeLine.offset,
      )
      const endOffset = closeLine.offset + closeLine.text.length + closeLine.eol.length
      blocks.push({
        lang: lang.length > 0 ? lang : null,
        content,
        startLine,
        endLine: j + 1,
        closed: true,
        fenceChar: open.fenceChar,
        fenceLength: open.fenceLength,
        startOffset,
        endOffset,
      })
      i = j + 1
    } else {
      // Unclosed — consume rest of input.
      const lastLine = lines[lines.length - 1]!
      const content = text.slice(contentStartOffset)
      blocks.push({
        lang: lang.length > 0 ? lang : null,
        content,
        startLine,
        endLine: lines.length,
        closed: false,
        fenceChar: open.fenceChar,
        fenceLength: open.fenceLength,
        startOffset,
        endOffset: lastLine.offset + lastLine.text.length + lastLine.eol.length,
      })
      i = lines.length
    }
  }
  return blocks
}

/**
 * Split `text` into an ordered list of prose / code segments. Concatenating
 * `s.text` (for prose) and the original fenced text (for code) reconstructs
 * the input byte-for-byte.
 *
 * Prose segments with empty `text` (adjacent code blocks, leading/trailing
 * code) are omitted.
 */
export function splitByCodeFences(text: string): Segment[] {
  const blocks = extractCodeBlocks(text)
  if (blocks.length === 0) {
    if (text.length === 0) return []
    return [
      {
        type: 'prose',
        text,
        startLine: 1,
        endLine: countLines(text),
      },
    ]
  }
  const out: Segment[] = []
  let cursor = 0
  let cursorLine = 1
  for (const block of blocks) {
    if (cursor < block.startOffset) {
      const proseText = text.slice(cursor, block.startOffset)
      const proseLineCount = countLines(proseText)
      out.push({
        type: 'prose',
        text: proseText,
        startLine: cursorLine,
        endLine: cursorLine + proseLineCount - 1,
      })
    }
    out.push({ type: 'code', block })
    cursor = block.endOffset
    cursorLine = block.endLine + 1
  }
  if (cursor < text.length) {
    const proseText = text.slice(cursor)
    const proseLineCount = countLines(proseText)
    out.push({
      type: 'prose',
      text: proseText,
      startLine: cursorLine,
      endLine: cursorLine + proseLineCount - 1,
    })
  }
  return out
}

/** Count the number of lines a piece of text spans (≥1 unless empty). */
function countLines(text: string): number {
  if (text.length === 0) return 0
  let n = 1
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') n++
    else if (text[i] === '\r' && text[i + 1] !== '\n') n++
  }
  // Trailing newline shouldn't add a phantom empty line.
  if (text.endsWith('\n') || text.endsWith('\r')) n--
  return Math.max(n, 1)
}

/**
 * Map a transform over every fenced code block; prose between (and around)
 * blocks is preserved unchanged. The transformer receives the parsed block
 * and returns the replacement string that occupies the block's slot,
 * including any fences if the caller wants them.
 */
export function replaceCodeBlocks(
  text: string,
  transformer: (block: CodeBlock) => string,
): string {
  const blocks = extractCodeBlocks(text)
  if (blocks.length === 0) return text
  const parts: string[] = []
  let cursor = 0
  for (const block of blocks) {
    if (cursor < block.startOffset) {
      parts.push(text.slice(cursor, block.startOffset))
    }
    parts.push(transformer(block))
    cursor = block.endOffset
  }
  if (cursor < text.length) parts.push(text.slice(cursor))
  return parts.join('')
}

/**
 * Return the first code block in `text`, optionally filtered by language
 * tag. Language comparison is case-insensitive; `null` lang matches blocks
 * that lacked an info string. Returns `null` if no match.
 */
export function findFirstCodeBlock(
  text: string,
  lang?: string | null,
): CodeBlock | null {
  const blocks = extractCodeBlocks(text)
  if (lang === undefined) return blocks[0] ?? null
  const target = lang === null ? null : lang.toLowerCase()
  for (const b of blocks) {
    const blockLang = b.lang === null ? null : b.lang.toLowerCase()
    if (blockLang === target) return b
  }
  return null
}

/**
 * If `text` consists of exactly one fenced code block — optionally
 * surrounded by whitespace-only prose — return the block's content (no
 * fences). Otherwise return `null`. Useful for detecting "the model
 * replied with only code".
 *
 * An unclosed block still counts: callers asking "is this code-only"
 * usually want yes.
 */
export function unwrapSingleCodeBlock(text: string): string | null {
  const segs = splitByCodeFences(text)
  let codeBlock: CodeBlock | null = null
  for (const s of segs) {
    if (s.type === 'code') {
      if (codeBlock !== null) return null
      codeBlock = s.block
    } else {
      // Prose around must be whitespace-only.
      if (s.text.trim().length > 0) return null
    }
  }
  return codeBlock?.content ?? null
}
