// src/core/wordWrap/wordWrap.ts
//
// Display-width-aware word wrap helpers. Pure logic — no React/ink, no
// LLM, no filesystem. Use these whenever you need to flow a long string
// into terminal columns: log formatters, TUI tool-summary renderers,
// blockquote-style prefixed output, anywhere a fixed-width cell budget
// has to be respected.
//
// Why a dedicated module? The Node ecosystem offers `wrap-ansi`, but
// our requirements creep past its surface:
//
//   • Configurable per-paragraph hanging indent (continuation lines)
//   • Configurable global indent (every output line)
//   • Optional caller-chosen prefixes for first vs continuation lines
//     (markdown-style `> ` blockquotes, list bullets, etc.)
//   • A predictable contract for inputs that already contain ANSI
//     escapes — escape bytes contribute zero columns, escape-bearing
//     words stay intact.
//
// The implementation here is a straight word-wrapper that counts in
// terminal *cells* (via the already-landed `core/stringWidth` module),
// so ANSI sequences, CJK glyphs, ZWJ emoji, and combining marks all
// land in the right column. Grapheme iteration is used for hard-break
// (`breakWord: true`) so surrogate pairs and emoji clusters never get
// split mid-codepoint.
//
// All grapheme iteration uses a cached Intl.Segmenter — cheap enough
// for hot-path use after the first construction.

import { stringWidth, stripAnsi } from '../stringWidth'

/**
 * Lazy-init grapheme segmenter. `Intl.Segmenter` is heavy (~few
 * hundred µs) to construct; one instance per process is sufficient.
 * Mirrors the pattern used by `core/truncate` and `core/stringWidth`.
 */
let cachedSegmenter: Intl.Segmenter | null = null
function segmenter(): Intl.Segmenter {
  if (!cachedSegmenter) {
    cachedSegmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })
  }
  return cachedSegmenter
}

/** Options shared by {@link wrapText} and {@link wrapLines}. */
export interface WrapOptions {
  /**
   * Target column budget. Each output line's display width (after
   * `indent` and any hanging-indent / prefix) will fit inside this
   * many cells when possible. Must be a positive integer; values of 0
   * or below short-circuit — the input is returned unchanged (single
   * paragraph) or as-paragraph-split (multi-paragraph), preserving
   * caller intent rather than producing one-cell-wide gibberish.
   */
  width: number
  /**
   * When `true`, words wider than the available budget are hard-broken
   * at a grapheme boundary so the result strictly fits. ANSI escapes
   * stay attached to the grapheme that produced them.
   *
   * When `false` (the default), an overlong word is placed on its own
   * line and is allowed to overflow the budget. This matches the
   * common terminal behaviour of "don't mangle a URL just to fit".
   */
  breakWord?: boolean
  /**
   * Cells of leading indentation to apply to the SECOND and
   * subsequent lines of each input paragraph. Useful for list-style
   * output (`"- first line"` then `"  continuation"`).
   *
   * The indent is filled with spaces. Must be a non-negative integer
   * smaller than `width`. If `hangingIndent + indent ≥ width`, the
   * indent is silently capped so the output never has a zero (or
   * negative) writable region.
   */
  hangingIndent?: number
  /**
   * Cells of leading indentation applied to EVERY output line
   * (including the first of each paragraph). Stacks additively with
   * `hangingIndent` on continuation lines. Same validation rules as
   * `hangingIndent`.
   */
  indent?: number
  /**
   * Controls how `\n` in the input is handled.
   *
   * `true` (default) — each `\n` starts a new paragraph; wrapping
   * happens independently within each paragraph and the boundaries
   * are preserved in the output.
   *
   * `false` — newlines are treated as ordinary whitespace; the entire
   * input is flowed as one paragraph.
   */
  preserveNewlines?: boolean
}

/** Options for {@link wrapWithPrefix}. */
export interface WrapWithPrefixOptions {
  /** Target column budget. Same rules as {@link WrapOptions.width}. */
  width: number
  /**
   * Prefix prepended to the FIRST line of every paragraph (e.g. `"> "`
   * for a blockquote, `"- "` for a bullet). Its display width is
   * subtracted from the wrap budget so the visible text plus prefix
   * fits in `width`.
   */
  firstPrefix: string
  /**
   * Prefix prepended to the SECOND and subsequent lines of every
   * paragraph (e.g. `"> "` for a blockquote, `"  "` to align under a
   * bullet). Its display width is subtracted from the wrap budget.
   */
  continuationPrefix: string
  /**
   * Same as {@link WrapOptions.breakWord}.
   */
  breakWord?: boolean
  /**
   * Same as {@link WrapOptions.preserveNewlines}.
   */
  preserveNewlines?: boolean
}

/**
 * Wrap `text` to fit in `opts.width` terminal cells per line, breaking
 * at word boundaries.
 *
 * Returns a single string with `\n` between wrapped lines. Use
 * {@link wrapLines} if you want the array form (one entry per line).
 *
 * Edge cases:
 *  - Empty input → empty string.
 *  - `width ≤ 0` → input returned essentially unchanged (paragraph
 *    structure preserved if `preserveNewlines`).
 *  - Word wider than the writable region:
 *      • `breakWord: false` (default) → word kept whole on its own
 *        line; that line overflows the budget. This is the "don't
 *        mangle a URL" contract.
 *      • `breakWord: true` → word hard-broken at the budget boundary
 *        using grapheme iteration (no surrogate-pair splits).
 *  - ANSI escapes survive intact; their display width is counted as 0.
 *  - CJK / fullwidth glyphs count as 2 cells.
 *  - Existing `\n` boundaries are honoured iff `preserveNewlines` is
 *    true (the default).
 */
export function wrapText(text: string, opts: WrapOptions): string {
  return wrapLines(text, opts).join('\n')
}

/**
 * Same as {@link wrapText} but returns the wrapped output as an array
 * of lines (one entry per visible line, no trailing newline).
 *
 * This form is convenient for renderers that lay out lines vertically
 * (Ink Box children, log line emitters, etc.) and want to attach
 * per-line metadata without re-splitting on `\n`.
 */
export function wrapLines(text: string, opts: WrapOptions): string[] {
  if (typeof text !== 'string' || text.length === 0) return ['']

  const {
    width,
    breakWord = false,
    hangingIndent = 0,
    indent = 0,
    preserveNewlines = true,
  } = opts

  validateNonNegativeInt('hangingIndent', hangingIndent)
  validateNonNegativeInt('indent', indent)

  // Bail-out: width is meaningless. Return paragraph-split form
  // (preserving any caller newlines) so consumers downstream don't
  // crash but also don't get an unexpected merged blob.
  if (!Number.isFinite(width) || width <= 0) {
    if (preserveNewlines) return text.split('\n')
    return [text.replace(/\n+/g, ' ')]
  }

  const paragraphs = preserveNewlines ? text.split('\n') : [text.replace(/\n+/g, ' ')]

  const out: string[] = []
  for (const para of paragraphs) {
    if (para.length === 0) {
      // Preserve a blank paragraph as a blank output line so callers
      // see paragraph spacing in the result.
      out.push('')
      continue
    }
    for (const line of wrapParagraph(para, width, breakWord, hangingIndent, indent)) {
      out.push(line)
    }
  }
  return out
}

/**
 * Wrap `text` with caller-chosen prefixes on the first and
 * continuation lines. Convenient for blockquotes (`"> "`), bullet
 * lists (`"- "` + `"  "`), and other prefix-decorated layouts.
 *
 * The prefix's display width is subtracted from the budget before
 * wrapping, so the FULL visible line (prefix + text) fits inside
 * `opts.width` cells when possible. If the prefix alone is wider
 * than `width`, the wrap budget bottoms out at 1 cell — caller asked
 * for an impossible layout; we degrade gracefully rather than throw.
 *
 * Paragraph handling and `breakWord` semantics match {@link wrapText}.
 */
export function wrapWithPrefix(
  text: string,
  opts: WrapWithPrefixOptions,
): string {
  if (typeof text !== 'string' || text.length === 0) return ''
  const {
    width,
    firstPrefix,
    continuationPrefix,
    breakWord = false,
    preserveNewlines = true,
  } = opts

  // Compute inner budget so prefix + content ≤ width.
  const firstW = stringWidth(firstPrefix)
  const contW = stringWidth(continuationPrefix)
  const innerFirst = Math.max(1, width - firstW)
  const innerCont = Math.max(1, width - contW)
  // The wrap pass uses the SMALLER inner budget so continuation lines
  // fit too. Tighter budgets just wrap a touch earlier — visually
  // identical when prefixes are equal-width (the common case).
  const innerBudget = Math.min(innerFirst, innerCont)

  const paragraphs = preserveNewlines ? text.split('\n') : [text.replace(/\n+/g, ' ')]

  const lines: string[] = []
  for (const para of paragraphs) {
    if (para.length === 0) {
      lines.push(firstPrefix)
      continue
    }
    const wrapped = wrapParagraph(para, innerBudget, breakWord, 0, 0)
    for (let i = 0; i < wrapped.length; i++) {
      lines.push((i === 0 ? firstPrefix : continuationPrefix) + (wrapped[i] ?? ''))
    }
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function validateNonNegativeInt(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer, got ${value}`)
  }
}

/**
 * Wrap a single paragraph (no embedded `\n`) into lines that fit the
 * computed per-line budget.
 *
 * `indent` is prepended to every line; `hangingIndent` is added on top
 * of `indent` for lines 2+. The combined indent is capped at
 * `width - 1` so each line has at least one writable cell.
 */
function wrapParagraph(
  para: string,
  width: number,
  breakWord: boolean,
  hangingIndent: number,
  indent: number,
): string[] {
  // Cap indents so they leave at least one column for content.
  const firstIndent = Math.min(indent, Math.max(0, width - 1))
  const contIndent = Math.min(indent + hangingIndent, Math.max(0, width - 1))

  const firstBudget = Math.max(1, width - firstIndent)
  const contBudget = Math.max(1, width - contIndent)

  // Split on runs of whitespace. Note: we deliberately do NOT use
  // grapheme segmentation for the splitter — wrap boundaries are
  // word boundaries, and Unicode whitespace categorisation tracks
  // codepoints just fine for the languages a CLI cares about.
  // Trailing/leading whitespace on the paragraph is trimmed (matches
  // wrap-ansi's `trim: true` mode), which keeps the column math clean.
  const words = splitWords(para.trim())
  if (words.length === 0) return ['']

  const lines: string[] = []
  let curr: string[] = []
  let currW = 0
  let isFirst = true

  const budgetFor = (): number => (isFirst ? firstBudget : contBudget)
  const indentFor = (): number => (isFirst ? firstIndent : contIndent)

  const flush = (): void => {
    const line = ' '.repeat(indentFor()) + curr.join(' ')
    lines.push(line)
    curr = []
    currW = 0
    isFirst = false
  }

  for (const word of words) {
    const wordW = stringWidth(word)
    if (curr.length === 0) {
      // Empty line — does this single word fit?
      if (wordW <= budgetFor()) {
        curr.push(word)
        currW = wordW
        continue
      }
      // Word doesn't fit even alone.
      if (breakWord) {
        // Hard-split. Consume one budget's worth at a time.
        let remaining = word
        while (stringWidth(remaining) > budgetFor()) {
          const [head, tail] = hardSplitAtWidth(remaining, budgetFor())
          lines.push(' '.repeat(indentFor()) + head)
          remaining = tail
          isFirst = false
        }
        if (remaining.length > 0) {
          curr.push(remaining)
          currW = stringWidth(remaining)
        }
      } else {
        // Keep the word intact; let the line overflow.
        curr.push(word)
        currW = wordW
        flush()
      }
      continue
    }

    // Try to append to the current line.
    if (currW + 1 + wordW <= budgetFor()) {
      curr.push(word)
      currW += 1 + wordW
      continue
    }

    // Doesn't fit. Flush and retry this word on a fresh line.
    flush()
    if (wordW <= budgetFor()) {
      curr.push(word)
      currW = wordW
      continue
    }
    if (breakWord) {
      let remaining = word
      while (stringWidth(remaining) > budgetFor()) {
        const [head, tail] = hardSplitAtWidth(remaining, budgetFor())
        lines.push(' '.repeat(indentFor()) + head)
        remaining = tail
        isFirst = false
      }
      if (remaining.length > 0) {
        curr.push(remaining)
        currW = stringWidth(remaining)
      }
    } else {
      curr.push(word)
      currW = wordW
      flush()
    }
  }
  if (curr.length > 0) flush()
  return lines.length > 0 ? lines : ['']
}

/**
 * Split a string into whitespace-separated "words". Whitespace runs
 * are collapsed to single separators — wrap output is normalised, not
 * round-trippable to the input. This matches the well-known semantics
 * of `String.prototype.split(/\s+/)` but filters out empty leading /
 * trailing fragments that the regex split leaves behind.
 *
 * ANSI escapes belong to whichever word they happen to be embedded in;
 * they have zero display width so they ride along without cost.
 */
function splitWords(text: string): string[] {
  if (text.length === 0) return []
  // We intentionally only treat ASCII / Unicode whitespace as breaks.
  // Splitting on grapheme boundaries would mangle ANSI sequences that
  // straddle a word boundary in pathological inputs.
  return text.split(/\s+/).filter(w => w.length > 0)
}

/**
 * Cut `text` into the longest prefix whose display width is `≤ budget`
 * cells, plus the remainder. Iterates grapheme clusters so we never
 * split a surrogate pair, a ZWJ emoji, or a CRLF. ANSI escape bytes
 * are charge-zero and follow whichever grapheme they belong to.
 *
 * If `budget` is < 1, we still consume at least one grapheme — caller
 * asked us to break the unbreakable; an infinite-loop-safe degenerate
 * cut is preferable to throwing in a wrap pass.
 */
function hardSplitAtWidth(text: string, budget: number): [string, string] {
  if (text.length === 0) return ['', '']
  const guarded = Math.max(1, budget)
  let head = ''
  let used = 0
  let idx = 0
  let cutIdx = -1
  for (const { segment } of segmenter().segment(text)) {
    const segW = stringWidth(segment)
    if (used + segW > guarded && head.length > 0) {
      cutIdx = idx
      break
    }
    head += segment
    used += segW
    idx += segment.length
    if (used >= guarded) {
      cutIdx = idx
      break
    }
  }
  if (cutIdx < 0) return [text, '']
  return [head, text.slice(cutIdx)]
}

/**
 * Module-private re-export so tests / curious callers can verify the
 * width helper actually got hooked up. Not part of the public surface
 * — the index re-exports only the wrap functions and option types.
 */
export const __internals = { stripAnsi, stringWidth, hardSplitAtWidth }
