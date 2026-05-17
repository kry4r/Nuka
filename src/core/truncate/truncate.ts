// src/core/truncate/truncate.ts
//
// Smart text-truncation helpers. Pure logic — no React/ink, no LLM
// dependencies, no filesystem access. Use these when displaying long
// strings in the TUI, in logs, or in tool-result renderers, where a
// blunt `slice(0, N)` would either lose the tail (where errors often
// live) or split a multibyte grapheme.
//
// The three core strategies — middle-truncate by chars, head/tail by
// lines, and char-budget — match the patterns Nuka-Code uses inline in
// several call-sites (`utils/toolErrors.ts`, `tools/BashTool/utils.ts`,
// etc.). This module collects them into a single shared, tested,
// side-effect-free utility that future call-sites can migrate to.
//
// Unicode safety: head/tail char counts are measured on **graphemes**,
// using `Intl.Segmenter` (built-in to Node ≥ 16). That means a 4-byte
// emoji or a CRLF cluster counts as one "char" and is never split in
// the middle. Surrogate pairs are guaranteed intact.

/**
 * Lazy-init grapheme segmenter. `Intl.Segmenter` is fairly heavy to
 * construct (≈few hundred µs), so we cache one instance per process.
 */
let cachedSegmenter: Intl.Segmenter | null = null
function segmenter(): Intl.Segmenter {
  if (!cachedSegmenter) {
    cachedSegmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })
  }
  return cachedSegmenter
}

/**
 * Split a string into its grapheme clusters. A surrogate pair, a
 * regional-indicator flag emoji, or a CRLF all collapse to a single
 * element of the returned array.
 */
function graphemes(text: string): string[] {
  const out: string[] = []
  for (const { segment } of segmenter().segment(text)) {
    out.push(segment)
  }
  return out
}

/**
 * Default omission marker. Includes the count so the reader knows how
 * much was elided — important when a log shows up in a bug report.
 */
const DEFAULT_OMISSION_CHARS = (n: number): string => `…[${n} chars omitted]…`
const DEFAULT_OMISSION_LINES = (n: number): string => `…[${n} lines omitted]…`

/** Options for {@link truncateMiddle}. */
export interface TruncateMiddleOptions {
  /**
   * Maximum total length of the result, measured in grapheme clusters.
   * Must be at least 1. If the input already fits, it is returned
   * unchanged.
   */
  maxChars: number
  /**
   * Number of grapheme clusters to keep from the head. When omitted,
   * head and tail split the remaining budget evenly (head gets the
   * extra one on a tie).
   */
  headChars?: number
  /**
   * Number of grapheme clusters to keep from the tail. Same default
   * behaviour as `headChars`.
   */
  tailChars?: number
  /**
   * Override the omission marker. Receives the number of grapheme
   * clusters that were removed. The default emits
   * `…[N chars omitted]…`.
   */
  ellipsis?: (omittedCount: number) => string
}

/**
 * Truncate `text` by keeping a head and a tail and replacing the
 * middle with an omission marker.
 *
 * Useful for one-line summaries of long strings — error messages, file
 * paths, long tool outputs — where both the start (context) and the
 * end (the actual failure / final result) matter.
 *
 * When the budget is too small to fit `head + ellipsis + tail`, the
 * function degrades gracefully: it shrinks the head and tail (keeping
 * a 60/40 ratio favouring the head), and if even that doesn't fit it
 * returns just a marker without head/tail. The output never exceeds
 * `maxChars` graphemes.
 */
export function truncateMiddle(
  text: string,
  opts: TruncateMiddleOptions,
): string {
  const { maxChars, ellipsis = DEFAULT_OMISSION_CHARS } = opts
  if (maxChars < 1) {
    throw new RangeError(`maxChars must be ≥ 1, got ${maxChars}`)
  }
  if (text === '') return ''

  const segs = graphemes(text)
  if (segs.length <= maxChars) return text

  // Allocate head/tail. If neither is supplied, split the remaining
  // budget (after a placeholder marker) evenly. Head gets the extra
  // grapheme on an odd split.
  let head = opts.headChars
  let tail = opts.tailChars
  if (head === undefined && tail === undefined) {
    // Estimate marker width with the worst-case omitted count
    // (everything). Real marker is shorter, but using an upper bound
    // here means the final result is always ≤ maxChars.
    const markerWidth = graphemes(ellipsis(segs.length)).length
    const remaining = Math.max(0, maxChars - markerWidth)
    head = Math.ceil(remaining / 2)
    tail = Math.floor(remaining / 2)
  } else {
    head = head ?? 0
    tail = tail ?? 0
  }

  // Shrink head/tail proportionally until head + marker + tail ≤ maxChars.
  // Use the actual marker length once we know the omitted count.
  for (;;) {
    const omitted = segs.length - head - tail
    if (omitted <= 0) {
      // Nothing to omit — head + tail already covers the string.
      return text
    }
    const marker = ellipsis(omitted)
    const markerLen = graphemes(marker).length
    const total = head + markerLen + tail
    if (total <= maxChars) {
      return (
        segs.slice(0, head).join('') +
        marker +
        segs.slice(segs.length - tail).join('')
      )
    }
    // Doesn't fit. Shrink. Prefer keeping head over tail (60/40-ish).
    if (head + tail === 0) {
      // Only the marker can be shown. Cut it to maxChars.
      return graphemes(marker).slice(0, maxChars).join('')
    }
    if (head >= tail) head -= 1
    else tail -= 1
  }
}

/** Options for {@link truncateLines}. */
export interface TruncateLinesOptions {
  /** Maximum number of lines to keep in total. Must be ≥ 1. */
  maxLines: number
  /**
   * Number of head lines to keep. When omitted, head and tail split
   * the remaining budget evenly.
   */
  headLines?: number
  /** Number of tail lines to keep. */
  tailLines?: number
  /**
   * Override the omission marker (single line, no trailing newline).
   * Receives the number of lines omitted.
   */
  ellipsis?: (omittedCount: number) => string
}

/**
 * Truncate `text` by keeping the first `headLines` lines and the
 * last `tailLines` lines, replacing the middle with a one-line
 * omission marker.
 *
 * Newline style: lines are split on `\n`. A trailing `\n` on the
 * input is preserved on the output. Internal `\r` characters are left
 * alone (CRLF survives the round-trip).
 *
 * Single-line input with `maxLines ≥ 1` is returned unchanged, since
 * there is nothing to truncate.
 */
export function truncateLines(
  text: string,
  opts: TruncateLinesOptions,
): string {
  const { maxLines, ellipsis = DEFAULT_OMISSION_LINES } = opts
  if (maxLines < 1) {
    throw new RangeError(`maxLines must be ≥ 1, got ${maxLines}`)
  }
  if (text === '') return ''

  const endsWithNewline = text.endsWith('\n')
  // `split('\n')` on a string ending with '\n' yields a trailing ''
  // element; drop it and restore the newline at the end.
  const raw = text.split('\n')
  const lines = endsWithNewline ? raw.slice(0, -1) : raw
  if (lines.length <= maxLines) return text

  let head = opts.headLines
  let tail = opts.tailLines
  if (head === undefined && tail === undefined) {
    // Reserve one line for the marker, split the rest evenly.
    const remaining = Math.max(0, maxLines - 1)
    head = Math.ceil(remaining / 2)
    tail = Math.floor(remaining / 2)
  } else {
    head = head ?? 0
    tail = tail ?? 0
  }

  // Shrink to fit. The marker always occupies exactly one line.
  for (;;) {
    const omitted = lines.length - head - tail
    if (omitted <= 0) {
      // head + tail already covers the input — return as-is.
      return text
    }
    const total = head + 1 + tail // +1 for marker line
    if (total <= maxLines) {
      const out = [
        ...lines.slice(0, head),
        ellipsis(omitted),
        ...lines.slice(lines.length - tail),
      ].join('\n')
      return endsWithNewline ? out + '\n' : out
    }
    if (head + tail === 0) {
      // Only the marker fits. (maxLines === 0 was already rejected.)
      const out = ellipsis(omitted)
      return endsWithNewline ? out + '\n' : out
    }
    if (head >= tail) head -= 1
    else tail -= 1
  }
}

/**
 * Truncate `text` to at most `maxChars` grapheme clusters, preferring
 * to cut at a line boundary if one is close to the budget.
 *
 * If the input already fits, it is returned unchanged. Otherwise the
 * output is the longest line-aligned prefix that, together with the
 * omission marker, fits in the budget — or, if no line boundary is
 * within the last 20% of the budget, a hard grapheme cut.
 *
 * The marker is always appended as a separate line (preceded by `\n`)
 * unless the result has no trailing newline yet.
 */
export function truncateToCharBudget(text: string, maxChars: number): string {
  if (maxChars < 1) {
    throw new RangeError(`maxChars must be ≥ 1, got ${maxChars}`)
  }
  if (text === '') return ''

  const segs = graphemes(text)
  if (segs.length <= maxChars) return text

  const omitted = segs.length - maxChars
  const marker = DEFAULT_OMISSION_CHARS(omitted)
  const markerLen = graphemes(marker).length
  // Reserve space for the marker (and one separator newline).
  const budget = Math.max(0, maxChars - markerLen - 1)

  if (budget === 0) {
    // Not enough room for content + marker; just return as much
    // marker as fits, char-cut.
    return graphemes(marker).slice(0, maxChars).join('')
  }

  // Prefix is the first `budget` graphemes; look for a recent newline
  // to break at a line boundary.
  const prefix = segs.slice(0, budget).join('')
  const lastNewline = prefix.lastIndexOf('\n')
  const minLineBreak = Math.floor(prefix.length * 0.8) // last 20%
  const chosen =
    lastNewline >= minLineBreak ? prefix.slice(0, lastNewline) : prefix

  const omittedActual = segs.length - graphemes(chosen).length
  const finalMarker = DEFAULT_OMISSION_CHARS(omittedActual)
  return chosen + (chosen.endsWith('\n') ? '' : '\n') + finalMarker
}

/** Options for {@link smartTruncate}. */
export interface SmartTruncateOptions {
  /** Maximum total length, in grapheme clusters. Must be ≥ 1. */
  maxChars: number
  /**
   * When true (default), if the input is multi-line and crosses the
   * budget by enough to justify line-aware truncation, the line-based
   * strategy is used; otherwise a middle-truncate is chosen.
   */
  preferLineBoundary?: boolean
  /**
   * When true, if the input contains a fenced code block (``` …
   * ```) that would otherwise be split mid-fence, switch to
   * line-truncation outside the fence so fence integrity is
   * preserved. Best-effort — see implementation note below.
   *
   * Defaults to `false`.
   */
  preserveCodeFences?: boolean
}

/**
 * Pick a sensible truncation strategy based on the shape of `text`.
 *
 * Selection rules, in order:
 *   1. If `text` already fits in `maxChars`, return as-is.
 *   2. If `preserveCodeFences` is true **and** the input has an open
 *      fence that would be split, fall back to {@link truncateLines}
 *      so the fence opener/closer stays balanced.
 *   3. If `preferLineBoundary` is true and `text` has at least 4
 *      lines, use {@link truncateLines}.
 *   4. Otherwise use {@link truncateMiddle}.
 *
 * Implementation note on fences: balanced fence detection here is
 * intentionally simple — a count of ``` ``` ``` lines. A code block
 * that uses a different fence character (e.g. `~~~`) or nested
 * language-tagged fences is treated as no fence. The point is to
 * avoid the worst case (orphan opener), not to guarantee perfect
 * syntactic preservation of arbitrary markdown.
 */
export function smartTruncate(
  text: string,
  opts: SmartTruncateOptions,
): string {
  const {
    maxChars,
    preferLineBoundary = true,
    preserveCodeFences = false,
  } = opts
  if (maxChars < 1) {
    throw new RangeError(`maxChars must be ≥ 1, got ${maxChars}`)
  }
  if (text === '') return ''

  const segs = graphemes(text)
  if (segs.length <= maxChars) return text

  const lines = text.split('\n')
  const lineCount = text.endsWith('\n') ? lines.length - 1 : lines.length

  if (preserveCodeFences) {
    const fenceCount = countFenceLines(lines)
    if (fenceCount > 0 && fenceCount % 2 === 0 && lineCount >= 4) {
      // Even number of fences means balanced; preserve by line-cut.
      return truncateLines(text, { maxLines: lineBudget(maxChars, text) })
    }
  }

  if (preferLineBoundary && lineCount >= 4) {
    return truncateLines(text, { maxLines: lineBudget(maxChars, text) })
  }

  return truncateMiddle(text, { maxChars })
}

/**
 * Count fence-marker lines (lines starting with ``` ``` ```, possibly
 * with leading whitespace and an optional language tag).
 */
function countFenceLines(lines: readonly string[]): number {
  let count = 0
  for (const line of lines) {
    if (/^\s*```/.test(line)) count += 1
  }
  return count
}

/**
 * Convert a character budget into a line budget for a given text. We
 * assume an average line of ~40 graphemes; the result is bounded
 * between 3 (so head + marker + tail is meaningful) and the actual
 * line count.
 */
function lineBudget(maxChars: number, text: string): number {
  const avgLine = 40
  const guess = Math.max(3, Math.floor(maxChars / avgLine))
  const newlines = (text.match(/\n/g) ?? []).length
  const lineCount = text.endsWith('\n') ? newlines : newlines + 1
  return Math.min(guess, lineCount)
}
