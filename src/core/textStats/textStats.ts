// src/core/textStats/textStats.ts
//
// Pure-logic text statistics. No React/ink, no LLM, no filesystem.
// Use this when you need a quick, dependency-free read on a string —
// e.g. prompt context-budget estimation, message size logs, content
// dashboards, "you typed N words" feedback.
//
// Why a dedicated module? Nuka-Code (the upstream reference) inlines
// several ad-hoc variants of this idea — `countLines` in
// `FileWriteTool/UI.tsx`, `charCount` in `commands/copy/copy.tsx`,
// `wordCount` in `services/PromptSuggestion/promptSuggestion.ts`,
// `systemCharCount` in `services/api/promptCacheBreakDetection.ts` —
// each with its own per-call split-on-whitespace or `.length`-style
// math. Different call-sites disagree on:
//
//   • whether a trailing `\n` is a terminator or a separator (this
//     module: terminator — matches editor line numbering)
//   • whether to count visual width or codepoints
//   • whether to strip ANSI escapes first
//   • whether multiple spaces produce 1 or N words
//
// This module collects them into a single tested surface so future
// call-sites can converge. For visual width / byte counting we
// delegate to the well-tested helpers in `../stringWidth`.
//
// Sentence detection is best-effort. We split on a run of `.`, `!`,
// `?` (so `...` and `!?` count as one terminator, not three) followed
// by whitespace or EOF. Abbreviations like `Mr.`, `e.g.`, `U.S.` will
// inflate the count — this is documented and not worth chasing
// without an NLP dep, which the module is too small to justify.
// Decimal numbers like `3.14` *don't* inflate: a `.` followed by a
// non-space is rejected as a terminator. If you need linguistic
// accuracy, use a real tokenizer.
//
// All public functions are total: they always return a number / a
// fully-populated `TextStats`. Empty input yields all zeros. Edge
// cases (whitespace-only, no trailing newline, mixed line endings)
// are exhaustively covered by the test file.

import { stringWidth, stripAnsi } from '../stringWidth'

/** Options shared by {@link textStats} and the convenience counters. */
export interface TextStatsOptions {
  /**
   * Width to charge for a `\t` character when computing
   * {@link TextStats.visualWidth}. Defaults to 8 — the de-facto
   * terminal default. Forwarded to {@link stringWidth}.
   */
  tabWidth?: number
  /**
   * When `false` (the default), ANSI escape sequences are stripped
   * before all counting — they contribute zero chars, zero width, and
   * are excluded from word/sentence/paragraph detection. Bytes still
   * reflect the original (un-stripped) UTF-8 encoding so the count
   * matches what a `wc -c` would report on the raw input.
   *
   * When `true`, ANSI bytes are counted as literal text: each escape
   * sequence contributes one char per UTF-16 code unit and visual
   * width follows whatever `stringWidth({ countAnsi: true })` reports.
   * Use this only when you've already manually stripped escapes
   * upstream and the residual is supposed to render literally.
   */
  countAnsi?: boolean
}

/** Output of {@link textStats}. All fields are `>= 0`. */
export interface TextStats {
  /** Total UTF-16 code units after ANSI stripping (unless `countAnsi`). */
  chars: number
  /** Display width in terminal cells. Uses {@link stringWidth} math. */
  visualWidth: number
  /**
   * UTF-8 byte length of the **original** input — independent of
   * `countAnsi`. Matches `Buffer.byteLength(text, 'utf8')` /
   * `new TextEncoder().encode(text).length`.
   */
  bytes: number
  /**
   * Number of visible lines. A trailing newline is treated as a line
   * terminator (not a new empty line), so `"a\n"` is 1 line and
   * `"a\nb"` is 2. Empty string is 0. Recognizes `\n`, `\r\n`, and
   * lone `\r`.
   */
  lines: number
  /**
   * Number of whitespace-separated tokens. Multiple consecutive
   * spaces / tabs / newlines collapse to one separator. Leading and
   * trailing whitespace doesn't produce empty tokens.
   */
  words: number
  /**
   * Number of sentences detected by a run of `[.!?]` followed by
   * whitespace or end-of-text. Runs (`...`, `!?!`) count as one
   * terminator. Abbreviations are over-counted; see the module
   * header. A non-empty paragraph with no terminal punctuation still
   * counts as 1 sentence.
   */
  sentences: number
  /**
   * Number of paragraphs, separated by a blank line (one or more
   * consecutive newline-only or whitespace-only lines). A non-empty
   * input with no blank lines is 1 paragraph.
   */
  paragraphs: number
  /**
   * Mean visible characters per line (chars excluding line
   * terminators). 0 when `lines === 0`.
   */
  avgLineLength: number
  /** Mean character length of a word. 0 when `words === 0`. */
  avgWordLength: number
  /** Mean number of words per sentence. 0 when `sentences === 0`. */
  avgWordsPerSentence: number
}

/**
 * Compute statistics for the given text. Pure, allocation-light,
 * linear in the input length — no quadratic scans, no regex
 * backtracking on the hot path.
 *
 * @param text - input string (any encoding the JS runtime supports)
 * @param opts - see {@link TextStatsOptions}
 */
export function textStats(text: string, opts: TextStatsOptions = {}): TextStats {
  // Always-on guard: support callers that pass `null` / `undefined`
  // via dynamic types. We treat those as empty so the function stays
  // total.
  if (typeof text !== 'string' || text.length === 0) {
    return zeroStats()
  }

  const { tabWidth = 8, countAnsi = false } = opts

  // Byte count is always over the raw input — `wc -c` semantics.
  const bytes = utf8ByteLength(text)

  // For everything else, optionally strip ANSI so escape sequences
  // don't masquerade as words / chars / extra lines.
  const effective = countAnsi ? text : stripAnsi(text)

  if (effective.length === 0) {
    return { ...zeroStats(), bytes }
  }

  const chars = effective.length
  const visualWidth = stringWidth(effective, { tabWidth, countAnsi })

  const lines = countLinesInternal(effective)
  const words = countWordsInternal(effective)
  const sentences = countSentencesInternal(effective)
  const paragraphs = countParagraphsInternal(effective)

  // avgLineLength is "visible chars per line" — exclude line
  // terminators from the numerator so a 10-char-line file with 5
  // lines averages 10, not 11. Cheapest accurate path is to count
  // non-newline chars directly.
  const nonNewlineChars = countNonNewlineChars(effective)
  const avgLineLength = lines > 0 ? nonNewlineChars / lines : 0

  // avgWordLength: total non-whitespace chars / word count.
  const nonWsChars = countNonWhitespaceChars(effective)
  const avgWordLength = words > 0 ? nonWsChars / words : 0

  const avgWordsPerSentence = sentences > 0 ? words / sentences : 0

  return {
    chars,
    visualWidth,
    bytes,
    lines,
    words,
    sentences,
    paragraphs,
    avgLineLength,
    avgWordLength,
    avgWordsPerSentence,
  }
}

/**
 * Count visible lines. A trailing newline is treated as a line
 * terminator (not a new empty line), matching editor line numbering.
 * Empty string returns 0.
 *
 * Recognizes `\n`, `\r\n`, and lone `\r` as line separators. ANSI
 * escapes are stripped first unless `countAnsi: true`.
 */
export function countLines(text: string, opts: TextStatsOptions = {}): number {
  if (typeof text !== 'string' || text.length === 0) return 0
  const effective = opts.countAnsi === true ? text : stripAnsi(text)
  return countLinesInternal(effective)
}

/**
 * Count whitespace-separated words. Multiple consecutive whitespace
 * characters (spaces, tabs, newlines) collapse to one separator.
 * Leading / trailing whitespace doesn't produce empty tokens.
 *
 * Empty / whitespace-only input returns 0. ANSI escapes are stripped
 * first unless `countAnsi: true`.
 */
export function countWords(text: string, opts: TextStatsOptions = {}): number {
  if (typeof text !== 'string' || text.length === 0) return 0
  const effective = opts.countAnsi === true ? text : stripAnsi(text)
  return countWordsInternal(effective)
}

/**
 * Count sentences detected by a run of `[.!?]` followed by whitespace
 * or end-of-text. Best-effort: abbreviations (`Mr. Smith`) inflate
 * the count. Decimal numbers (`3.14`) and consecutive runs (`...`)
 * don't. A non-empty paragraph with no terminal punctuation still
 * counts as 1.
 *
 * Empty / whitespace-only input returns 0. ANSI escapes are stripped
 * first unless `countAnsi: true`.
 */
export function countSentences(text: string, opts: TextStatsOptions = {}): number {
  if (typeof text !== 'string' || text.length === 0) return 0
  const effective = opts.countAnsi === true ? text : stripAnsi(text)
  return countSentencesInternal(effective)
}

/**
 * Count paragraphs separated by one or more blank lines (lines that
 * are empty or whitespace-only). A non-empty input with no blank
 * lines is 1 paragraph.
 *
 * Empty / whitespace-only input returns 0. ANSI escapes are stripped
 * first unless `countAnsi: true`.
 */
export function countParagraphs(text: string, opts: TextStatsOptions = {}): number {
  if (typeof text !== 'string' || text.length === 0) return 0
  const effective = opts.countAnsi === true ? text : stripAnsi(text)
  return countParagraphsInternal(effective)
}

// ---------------------------------------------------------------------------
// Internals. Operate on the already-ANSI-stripped string so the public
// functions can share the strip pass with `textStats()`.
// ---------------------------------------------------------------------------

function zeroStats(): TextStats {
  return {
    chars: 0,
    visualWidth: 0,
    bytes: 0,
    lines: 0,
    words: 0,
    sentences: 0,
    paragraphs: 0,
    avgLineLength: 0,
    avgWordLength: 0,
    avgWordsPerSentence: 0,
  }
}

/**
 * UTF-8 byte length without allocating a TextEncoder buffer — counts
 * code points and applies the standard 1/2/3/4-byte encoding rules,
 * with surrogate-pair detection for codepoints above U+FFFF.
 *
 * Equivalent to `Buffer.byteLength(s, 'utf8')` but works in any JS
 * runtime (no Node Buffer dep) and avoids the allocation cost of
 * `new TextEncoder().encode(s).length` on hot paths.
 */
function utf8ByteLength(text: string): number {
  let bytes = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 0x80) {
      bytes += 1
    } else if (code < 0x800) {
      bytes += 2
    } else if (code >= 0xd800 && code <= 0xdbff) {
      // High surrogate — paired with the next low surrogate to form a
      // codepoint in the supplementary plane (4 UTF-8 bytes).
      const next = text.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        i += 1 // consume the low surrogate
      } else {
        // Unpaired high surrogate. Encoders typically emit U+FFFD
        // (3 bytes); match that so the count stays comparable to
        // `Buffer.byteLength`.
        bytes += 3
      }
    } else {
      // Including unpaired low surrogates, which also become U+FFFD.
      bytes += 3
    }
  }
  return bytes
}

/**
 * Split on `\r\n` | `\n` | `\r` and treat a trailing terminator as
 * "not a new empty line". Mirrors the editor convention used by
 * Nuka-Code's `FileWriteTool/UI.tsx#countLines`.
 */
function countLinesInternal(text: string): number {
  if (text.length === 0) return 0
  // Normalize the three accepted terminators to `\n`. Cheap on
  // typical inputs (no `\r` → no allocation beyond the no-op replace).
  const normalized =
    text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text

  // Count `\n` directly — faster than `.split('\n').length` because
  // it skips the intermediate array allocation.
  let lines = 0
  for (let i = 0; i < normalized.length; i++) {
    if (normalized.charCodeAt(i) === 0x0a) lines += 1
  }
  // If the last char isn't a newline, the trailing partial line
  // still counts. If it is a newline, we already counted it as a
  // terminator for the previous line — don't double-count.
  if (normalized.charCodeAt(normalized.length - 1) !== 0x0a) {
    lines += 1
  }
  return lines
}

/**
 * Whitespace-collapsed token count. Match `/\S+/g` semantics without
 * the `.match()` array allocation.
 */
function countWordsInternal(text: string): number {
  let count = 0
  let inWord = false
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    // ASCII whitespace fast path: space, tab, LF, CR, VT, FF.
    const isAsciiWs =
      code === 0x20 ||
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0d ||
      code === 0x0b ||
      code === 0x0c
    // For non-ASCII, fall back to the JS engine's Unicode-aware
    // whitespace classifier — covers NBSP, ideographic space, etc.
    const isWs = isAsciiWs || (code > 0x7f && /\s/.test(text[i] as string))
    if (isWs) {
      inWord = false
    } else if (!inWord) {
      inWord = true
      count += 1
    }
  }
  return count
}

/**
 * Sentence count via terminal-punctuation scan. Matches
 * `/[.!?]+(?:\s|$)/g.length` but as a single forward pass without the
 * `.match()` allocation.
 *
 * A non-empty body of text with no terminal punctuation still counts
 * as one sentence — otherwise "hello world" would be 0 sentences,
 * which surprises every caller.
 */
function countSentencesInternal(text: string): number {
  let count = 0
  let inPunct = false
  let sawNonWsSincePunct = false
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    const isTerm = ch === 0x2e /* . */ || ch === 0x21 /* ! */ || ch === 0x3f /* ? */
    const isWs =
      ch === 0x20 ||
      ch === 0x09 ||
      ch === 0x0a ||
      ch === 0x0d ||
      ch === 0x0b ||
      ch === 0x0c
    if (isTerm) {
      inPunct = true
    } else {
      if (inPunct && (isWs || i === text.length)) {
        // Already handled in the "close" branch below; fall through.
      }
      if (inPunct) {
        // Punctuation run ended on a non-whitespace, non-terminal char
        // (e.g. `3.14` — `.` followed by `1`). That's not a sentence
        // boundary; reset.
        if (!isWs) {
          inPunct = false
        }
      }
      if (!isWs) sawNonWsSincePunct = true
    }
    // Close a punctuation run when we hit whitespace.
    if (inPunct && isWs) {
      count += 1
      inPunct = false
      sawNonWsSincePunct = false
    }
  }
  // EOF closes any open punctuation run.
  if (inPunct) {
    count += 1
  } else if (sawNonWsSincePunct && count === 0) {
    // Non-empty body, no terminal punctuation seen at all → still 1.
    count = 1
  }
  return count
}

/**
 * Paragraph count: split on blank-line separators. A blank line is a
 * line that is empty or contains only whitespace. Multiple blank
 * lines in a row count as one separator.
 */
function countParagraphsInternal(text: string): number {
  if (text.length === 0) return 0
  // Normalize CRLF → LF so the split works uniformly.
  const normalized =
    text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text

  // Walk the string a line at a time, tracking whether we're
  // currently inside a paragraph. Allocating one substring per line
  // would be unnecessary; we step through `lastIdx`.
  let count = 0
  let inParagraph = false
  let lineStart = 0
  for (let i = 0; i <= normalized.length; i++) {
    const atEol = i === normalized.length || normalized.charCodeAt(i) === 0x0a
    if (!atEol) continue
    // Inspect [lineStart, i)
    let hasNonWs = false
    for (let j = lineStart; j < i; j++) {
      const c = normalized.charCodeAt(j)
      const ws =
        c === 0x20 || c === 0x09 || c === 0x0d || c === 0x0b || c === 0x0c
      // Defer to JS for non-ASCII whitespace.
      if (!ws && (c <= 0x7f || !/\s/.test(normalized[j] as string))) {
        hasNonWs = true
        break
      }
    }
    if (hasNonWs) {
      if (!inParagraph) {
        count += 1
        inParagraph = true
      }
    } else {
      inParagraph = false
    }
    lineStart = i + 1
  }
  return count
}

/**
 * Count chars that are not `\n`, `\r`, `\v`, or `\f`. Used as the
 * numerator for {@link TextStats.avgLineLength}.
 */
function countNonNewlineChars(text: string): number {
  let n = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c !== 0x0a && c !== 0x0d && c !== 0x0b && c !== 0x0c) n += 1
  }
  return n
}

/**
 * Count chars that aren't whitespace by JS semantics. Used as the
 * numerator for {@link TextStats.avgWordLength}.
 */
function countNonWhitespaceChars(text: string): number {
  let n = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    const asciiWs =
      c === 0x20 ||
      c === 0x09 ||
      c === 0x0a ||
      c === 0x0d ||
      c === 0x0b ||
      c === 0x0c
    if (asciiWs) continue
    if (c > 0x7f && /\s/.test(text[i] as string)) continue
    n += 1
  }
  return n
}
