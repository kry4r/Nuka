// src/core/stringWidth/stringWidth.ts
//
// Terminal display-width helpers. Pure logic — no React/ink, no LLM,
// no filesystem. Use these whenever you need to know "how many cells
// will this string consume when rendered to a terminal" — TUI width
// math, padding/alignment in Monitor output, truncation that respects
// visual width rather than .length, etc.
//
// Why a dedicated module? `String.prototype.length` measures UTF-16
// code units, which is the wrong answer for any text with ANSI
// escapes, emoji, CJK, combining marks, or surrogate pairs:
//
//   • ANSI sequences consume zero columns but inflate `.length`
//   • CJK / fullwidth chars occupy two cells each
//   • Emoji (especially ZWJ sequences) span multiple code points but
//     render as one grapheme of width 2
//   • Combining marks contribute zero columns
//   • Surrogate pairs are two .length but one grapheme
//   • Tabs have terminal-dependent width
//
// We wrap the well-tested `string-width` npm package (Sindre Sorhus,
// uses Intl.Segmenter + East Asian Width + RGI emoji classification),
// already a Nuka dep, and add a few helpers on top — char-by-char
// width, tab-aware width, width-aware truncate, width-aware pad —
// that the package itself doesn't ship.
//
// All grapheme iteration uses a cached Intl.Segmenter (≈few hundred
// µs to construct), so callers can safely call these in hot paths
// like layout passes without paying that cost per call.

import sw, { type Options as StringWidthOptions } from 'string-width'
import stripAnsiPkg from 'strip-ansi'

/**
 * Lazy-init grapheme segmenter. Constructing Intl.Segmenter is
 * expensive; one instance per process is enough.
 */
let cachedSegmenter: Intl.Segmenter | null = null
function segmenter(): Intl.Segmenter {
  if (!cachedSegmenter) {
    cachedSegmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })
  }
  return cachedSegmenter
}

/**
 * Remove ANSI escape sequences (CSI / SGR / OSC / etc.) from the
 * given text. Re-exported from `strip-ansi` so callers can grab
 * everything from one entry point.
 */
export function stripAnsi(text: string): string {
  if (typeof text !== 'string' || text.length === 0) return ''
  return stripAnsiPkg(text)
}

/** Options for {@link stringWidth}. */
export interface StringWidthOpts {
  /**
   * Width to charge for a `\t` character. Defaults to 8 (the de-facto
   * terminal default; xterm/iTerm/macOS Terminal all ship with this).
   * Set to 0 to ignore tabs (matches `string-width`'s default).
   */
  tabWidth?: number
  /**
   * When `false` (the default), ANSI escape sequences contribute zero
   * width — they're stripped before measurement.
   *
   * When `true`, ANSI bytes are counted as if they were printable —
   * useful when you've already manually stripped escapes upstream and
   * the residual is supposed to render literally.
   */
  countAnsi?: boolean
  /**
   * Count [ambiguous-width](https://www.unicode.org/reports/tr11/#Ambiguous)
   * characters as narrow (width 1) rather than wide (width 2).
   * Defaults to `true`, matching `string-width` and Unicode's
   * Western-context recommendation. Set to `false` only if you know
   * your audience renders in a CJK locale.
   */
  ambiguousIsNarrow?: boolean
}

/**
 * Width of a single Unicode codepoint, as a terminal cell count.
 * Returns 0 for non-printable / combining / zero-width, 2 for CJK
 * fullwidth, 1 for everything else printable.
 *
 * Note: this is *codepoint*-granularity, not grapheme. Use
 * {@link stringWidth} for full strings — a ZWJ emoji sequence like
 * 👨‍👩‍👧 spans multiple codepoints but renders as one width-2
 * cluster.
 */
export function charWidth(codepoint: number): 0 | 1 | 2 {
  if (!Number.isInteger(codepoint) || codepoint < 0) return 0
  // Re-use the well-tested string-width logic by converting the
  // codepoint to a string of length 1-or-2 and measuring it. That's
  // a tad heavier than a raw EAW lookup but avoids shipping our own
  // width tables (which would drift).
  const ch = String.fromCodePoint(codepoint)
  const w = sw(ch, { ambiguousIsNarrow: true })
  if (w >= 2) return 2
  if (w === 1) return 1
  return 0
}

/**
 * Total display width of `text` in terminal cells, accounting for
 * ANSI escapes, wide CJK glyphs, combining marks, ZWJ sequences,
 * variation selectors, and tabs.
 *
 *   stringWidth('hello')      === 5
 *   stringWidth('古')         === 2
 *   stringWidth('[1mx') === 1   // ANSI dropped
 *   stringWidth('a\tb')       === 10  // tab default = 8
 *   stringWidth('👨‍👩‍👧')      === 2   // ZWJ cluster
 *   stringWidth('café')       === 4   // combining mark counts 0
 */
export function stringWidth(text: string, opts: StringWidthOpts = {}): number {
  if (typeof text !== 'string' || text.length === 0) return 0

  const { tabWidth = 8, countAnsi = false, ambiguousIsNarrow = true } = opts

  if (tabWidth < 0 || !Number.isInteger(tabWidth)) {
    throw new RangeError(`tabWidth must be a non-negative integer, got ${tabWidth}`)
  }

  const swOpts: StringWidthOptions = {
    ambiguousIsNarrow,
    countAnsiEscapeCodes: countAnsi,
  }

  // Fast path: no tabs → defer entirely to string-width.
  if (!text.includes('\t')) {
    return sw(text, swOpts)
  }

  // Tab handling. string-width treats `\t` as width 0; we want a
  // caller-configurable column count. Split on tab, measure each
  // segment, and add the tab width contributions.
  const parts = text.split('\t')
  let width = 0
  for (let i = 0; i < parts.length; i++) {
    width += sw(parts[i] ?? '', swOpts)
    if (i < parts.length - 1) width += tabWidth
  }
  return width
}

/** Options for {@link truncateByWidth}. */
export interface TruncateByWidthOptions {
  /**
   * Tail marker. Default is `'…'` (U+2026, one cell). Pass `''` to
   * truncate without any marker. The marker's own display width is
   * subtracted from the budget, so the final result is never wider
   * than `maxColumns`.
   */
  ellipsis?: string
  /**
   * Same as {@link StringWidthOpts.tabWidth}. Defaults to 8.
   */
  tabWidth?: number
  /**
   * Same as {@link StringWidthOpts.ambiguousIsNarrow}.
   */
  ambiguousIsNarrow?: boolean
}

/**
 * Truncate `text` so its display width is at most `maxColumns`
 * cells, appending an ellipsis when truncation actually happens.
 *
 * Differs from a `.slice(0, n)`-style truncate in three ways:
 *
 *  1. Counts in terminal cells, not UTF-16 code units. A string of
 *     ten CJK chars has width 20.
 *  2. Never splits a surrogate pair or a grapheme cluster — ZWJ
 *     emoji and CRLF stay intact.
 *  3. Strips ANSI escapes before measuring, but does **not** carry
 *     them through to the output. (If you need ANSI preservation,
 *     wrap your colourized chunks separately.)
 *
 * If the input already fits, it is returned unchanged.
 * If `maxColumns < width(ellipsis)`, the result is a hard cell-cut
 * with no marker — caller asked for less than the marker takes.
 */
export function truncateByWidth(
  text: string,
  maxColumns: number,
  opts: TruncateByWidthOptions = {},
): string {
  if (typeof text !== 'string') return ''
  if (!Number.isFinite(maxColumns) || maxColumns < 0) {
    throw new RangeError(`maxColumns must be ≥ 0, got ${maxColumns}`)
  }
  if (text.length === 0 || maxColumns === 0) return ''

  const { ellipsis = '…', tabWidth = 8, ambiguousIsNarrow = true } = opts
  const widthOpts: StringWidthOpts = { tabWidth, ambiguousIsNarrow }

  // Strip ANSI before iterating; mixing ANSI bytes with grapheme
  // segmentation gets confusing fast, and callers asking for visual
  // truncation usually want the visible text.
  const visible = stripAnsi(text)
  if (visible.length === 0) return ''

  const totalWidth = stringWidth(visible, widthOpts)
  if (totalWidth <= maxColumns) return visible

  const ellipsisWidth = stringWidth(ellipsis, widthOpts)

  // Caller's budget can't even fit the marker. Hard-cut visible
  // graphemes until we run out of room. This is the only case where
  // we drop the marker entirely.
  if (ellipsisWidth >= maxColumns) {
    return hardCutByWidth(visible, maxColumns, widthOpts)
  }

  const budget = maxColumns - ellipsisWidth
  const prefix = hardCutByWidth(visible, budget, widthOpts)
  return prefix + ellipsis
}

/**
 * Cut `text` to ≤ `maxColumns` cells without appending any marker.
 * Iterates grapheme clusters so we never split surrogates or ZWJ
 * sequences mid-cluster. Tabs follow the configured tabWidth.
 *
 * Exposed because two paths in this file need it (truncateByWidth's
 * marker / non-marker branches), but kept module-private — callers
 * should use {@link truncateByWidth} with `ellipsis: ''` to get the
 * same effect with a stable public surface.
 */
function hardCutByWidth(
  text: string,
  maxColumns: number,
  widthOpts: StringWidthOpts,
): string {
  if (maxColumns <= 0) return ''
  let out = ''
  let used = 0
  for (const { segment } of segmenter().segment(text)) {
    const w = stringWidth(segment, widthOpts)
    if (used + w > maxColumns) break
    out += segment
    used += w
    if (used === maxColumns) break
  }
  return out
}

/** Options for {@link padToWidth}. */
export interface PadToWidthOptions {
  /**
   * Alignment of the input text within the padded result.
   *  - `'left'`   (default): text on the left, fill on the right
   *  - `'right'`: fill on the left, text on the right
   *  - `'center'`: fill split, right-biased on odd remainder
   */
  align?: 'left' | 'right' | 'center'
  /**
   * Single character to use for the fill. Defaults to a space.
   * Must have display width exactly 1. A multi-cell fill (e.g. a
   * CJK glyph) would make the final width unstable, so this is
   * validated and rejected.
   */
  fillChar?: string
  /**
   * Same as {@link StringWidthOpts.tabWidth}. Defaults to 8.
   */
  tabWidth?: number
  /**
   * Same as {@link StringWidthOpts.ambiguousIsNarrow}.
   */
  ambiguousIsNarrow?: boolean
}

/**
 * Pad `text` with `fillChar` until its total display width is
 * `targetColumns`. If the input is already at or beyond the target,
 * it is returned unchanged (no truncation — combine with
 * {@link truncateByWidth} if you need both).
 *
 * Counts in terminal cells, so a CJK char plus 3-cell padding gives
 * a 5-cell-wide result, not a 5-character-long one.
 */
export function padToWidth(
  text: string,
  targetColumns: number,
  opts: PadToWidthOptions = {},
): string {
  if (typeof text !== 'string') text = ''
  if (!Number.isFinite(targetColumns) || targetColumns < 0) {
    throw new RangeError(`targetColumns must be ≥ 0, got ${targetColumns}`)
  }

  const {
    align = 'left',
    fillChar = ' ',
    tabWidth = 8,
    ambiguousIsNarrow = true,
  } = opts

  if (fillChar.length === 0) {
    throw new RangeError('fillChar must be a non-empty string')
  }
  const fillW = stringWidth(fillChar, { tabWidth, ambiguousIsNarrow })
  if (fillW !== 1) {
    throw new RangeError(
      `fillChar must have display width 1, got "${fillChar}" (width ${fillW})`,
    )
  }

  const currentW = stringWidth(text, { tabWidth, ambiguousIsNarrow })
  if (currentW >= targetColumns) return text

  const pad = targetColumns - currentW
  if (align === 'left') return text + fillChar.repeat(pad)
  if (align === 'right') return fillChar.repeat(pad) + text
  // center: split, with the extra cell on the right when odd
  const left = Math.floor(pad / 2)
  const right = pad - left
  return fillChar.repeat(left) + text + fillChar.repeat(right)
}
