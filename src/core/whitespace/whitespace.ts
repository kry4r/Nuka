// src/core/whitespace/whitespace.ts
//
// Pure-string whitespace cleanup helpers for sanitizing model output,
// prompt context, and diff input. No React/ink, no LLM, no filesystem
// — just string in, string out.
//
// ## Function inventory
//
//   normalizeLineEndings  — CRLF / CR → LF (or → CRLF)
//   trimTrailingWhitespace — strip trailing horizontal whitespace per line
//   trimLeadingBlankLines  — drop blank lines at the top
//   trimTrailingBlankLines — drop blank lines at the bottom
//   trimBlankLines         — both ends
//   collapseBlankLines     — collapse N+ consecutive blanks to maxConsecutive
//   expandTabs             — leading-and-mid tabs → spaces (column-aware)
//   unexpandTabs           — leading spaces → tabs (block-aligned)
//   dedent                 — strip common leading indent across non-blank lines
//   normalize              — orchestrate the above with NormalizeOptions
//
// ## Design choices
//
//  - **Line endings.** Inside the module we always split on `\n` after
//    pre-normalizing `\r\n` and bare `\r` to `\n`. Functions that
//    preserve EOL information (e.g. `expandTabs` operating on a string
//    that contains CR) explicitly avoid the pre-normalize step. Callers
//    needing CRLF output should pipe through `normalizeLineEndings`
//    *last*.
//
//  - **"Blank line" definition.** A line is "blank" iff it contains only
//    whitespace characters (`/^\s*$/`). Note that this means a line
//    containing only a tab is blank. `trimTrailingWhitespace` runs
//    first inside `normalize()` so that blank-detection sees the
//    already-trimmed form.
//
//  - **`dedent` and blank lines.** Blank lines never participate in
//    common-indent computation — otherwise a single fully-empty line
//    would force the common indent to zero. After computing the indent,
//    blank lines have any leading whitespace stripped to zero columns
//    (so they remain blank regardless of their original spacing).
//
//  - **`dedent` and tabs.** Tabs in leading indent are expanded to the
//    configured `tabWidth` (default 8) for column comparison. We then
//    strip min-column spaces. Lines that have only spaces as leading
//    indent are stripped literally; lines that mix tabs and spaces are
//    rebuilt by expanding-to-space and removing the prefix.
//
//  - **`expandTabs` semantics.** Each `\t` advances the cursor to the
//    next multiple of `tabWidth`. We process *every* tab in the line,
//    not just leading ones — this matches GNU `expand(1)` default
//    behavior and is what you want for displaying source.
//
//  - **`unexpandTabs` semantics.** Only leading whitespace runs are
//    re-tabbed (matches GNU `unexpand(1)` default). We greedily group
//    `tabWidth` spaces into a single tab; any remainder stays as spaces.
//
//  - **Final newline preservation.** `trimTrailingBlankLines` drops a
//    trailing run of blank lines but *preserves* a single trailing
//    newline if the original ended with one — POSIX-text-file-friendly.
//    `normalize({ trimEdges: true })` follows the same rule by default;
//    pass `trimEdges: 'all'` (boolean true) is treated the same way.
//    There is no option to strip the final newline as well via this
//    module — callers can do `s.replace(/\n+$/, '')` themselves.
//
//  - **`normalize` order.** `expandTabs → dedent → trimTrailing →
//    collapseBlanks → trimEdges → lineEndings`. Each step's default is
//    chosen so the combined transform is roughly idempotent on
//    well-formed input.
//
//  - **Idempotence.** Every individual helper is idempotent on its own
//    output (modulo line-ending conversion which is a no-op the second
//    time). `normalize()` with default options is idempotent.
//
// The functions are pure and have no module-level state; safe to call
// concurrently from anywhere.

// ─── normalizeLineEndings ───────────────────────────────────────────

/** Output line-ending style. */
export type LineEndingStyle = 'lf' | 'crlf'

export interface NormalizeLineEndingsOptions {
  /** Target style. Defaults to `'lf'`. */
  to?: LineEndingStyle
}

/**
 *   normalizeLineEndings('foo\r\nbar\rbaz\n')         // 'foo\nbar\nbaz\n'
 *   normalizeLineEndings('foo\nbar', { to: 'crlf' })  // 'foo\r\nbar'
 *
 * Always passes through a normalize-to-LF step first so input with
 * mixed `\r\n`, lone `\r`, and lone `\n` all converge.
 */
export function normalizeLineEndings(
  text: string,
  opts: NormalizeLineEndingsOptions = {},
): string {
  if (typeof text !== 'string' || text.length === 0) return ''
  const { to = 'lf' } = opts
  // Pre-normalize all variants to '\n'.
  const lf = text.replace(/\r\n?/g, '\n')
  if (to === 'lf') return lf
  // Then re-emit as CRLF.
  return lf.replace(/\n/g, '\r\n')
}

// ─── trimTrailingWhitespace ─────────────────────────────────────────

/**
 *   trimTrailingWhitespace('foo  \nbar\t\n')  // 'foo\nbar\n'
 *
 * Removes trailing space/tab characters from each line. Preserves the
 * line terminators themselves (whether `\n` or `\r\n`).
 */
export function trimTrailingWhitespace(text: string): string {
  if (typeof text !== 'string' || text.length === 0) return ''
  // [^\S\r\n] = whitespace except CR/LF. We strip those before any EOL.
  return text.replace(/[^\S\r\n]+(?=\r?\n|$)/g, '')
}

// ─── trimLeadingBlankLines / trimTrailingBlankLines / trimBlankLines ─

/**
 *   trimLeadingBlankLines('\n\n  \nhello\nworld\n')  // 'hello\nworld\n'
 *
 * Drops any leading run of blank lines (lines containing only
 * whitespace). The first non-blank line is preserved as-is, including
 * its original leading whitespace.
 */
export function trimLeadingBlankLines(text: string): string {
  if (typeof text !== 'string' || text.length === 0) return ''
  // Match: zero or more "blank line plus newline" prefixes.
  // We use a CR-tolerant pattern so this works on CRLF input too.
  return text.replace(/^(?:[^\S\r\n]*\r?\n)+/, '')
}

/**
 *   trimTrailingBlankLines('foo\nbar\n\n\n')    // 'foo\nbar\n'
 *   trimTrailingBlankLines('foo\nbar')          // 'foo\nbar'
 *   trimTrailingBlankLines('foo\nbar\n')        // 'foo\nbar\n'
 *
 * Drops trailing blank lines but preserves a single trailing newline
 * if the input ended with one.
 */
export function trimTrailingBlankLines(text: string): string {
  if (typeof text !== 'string' || text.length === 0) return ''
  const endsWithNewline = /\r?\n$/.test(text)
  // To distinguish "content line with trailing space" from a true
  // blank line, split on \n (after CR/LF normalization) and drop
  // trailing lines whose entire content is whitespace-only.
  const usesCrlf = /\r\n/.test(text) && !/(?<!\r)\n/.test(text)
  const lf = text.replace(/\r\n?/g, '\n')
  // Split keeping no terminators (the trailing newline becomes an
  // empty final element which we'll re-attach via endsWithNewline).
  const body = endsWithNewline ? lf.slice(0, -1) : lf
  const lines = body.split('\n')
  while (lines.length > 0 && /^\s*$/.test(lines[lines.length - 1]!)) {
    lines.pop()
  }
  let s = lines.join('\n')
  if (s.length > 0 && endsWithNewline) {
    s += '\n'
  }
  return usesCrlf ? s.replace(/\n/g, '\r\n') : s
}

/**
 *   trimBlankLines('\n\nhello\nworld\n\n\n')  // 'hello\nworld\n'
 *
 * Combination of {@link trimLeadingBlankLines} +
 * {@link trimTrailingBlankLines}. Final-newline preservation rules of
 * the trailing helper apply.
 */
export function trimBlankLines(text: string): string {
  return trimTrailingBlankLines(trimLeadingBlankLines(text))
}

// ─── collapseBlankLines ─────────────────────────────────────────────

export interface CollapseBlankLinesOptions {
  /**
   * Maximum number of consecutive blank lines to permit. Defaults to
   * `1` (so a run of 5 blanks becomes 1 blank, i.e. two visible line
   * breaks). Setting `0` removes blank lines entirely.
   */
  maxConsecutive?: number
}

/**
 *   collapseBlankLines('a\n\n\n\nb')           // 'a\n\nb'        (default max=1)
 *   collapseBlankLines('a\n\n\nb', { maxConsecutive: 2 })  // 'a\n\n\nb'
 *   collapseBlankLines('a\n\n\nb', { maxConsecutive: 0 })  // 'a\nb'
 *
 * Counts a "blank line" as a line containing only whitespace. The
 * output replaces a long run with exactly `maxConsecutive` empty lines
 * — any leading whitespace on the original blank lines is stripped.
 */
export function collapseBlankLines(
  text: string,
  opts: CollapseBlankLinesOptions = {},
): string {
  if (typeof text !== 'string' || text.length === 0) return ''
  const max = Math.max(0, Math.floor(opts.maxConsecutive ?? 1))

  // Detect whether the input is CRLF-dominant so we can re-emit using
  // the same style for the collapsed blank lines.
  const usesCrlf = /\r\n/.test(text) && !/(?<!\r)\n/.test(text)
  const eol = usesCrlf ? '\r\n' : '\n'

  // Pre-normalize to LF for splitting, remember the trailing terminator
  // (or absence thereof) so we can re-attach it.
  const lfText = text.replace(/\r\n?/g, '\n')
  const hadFinalNewline = lfText.endsWith('\n')
  const body = hadFinalNewline ? lfText.slice(0, -1) : lfText
  const lines = body.split('\n')

  const out: string[] = []
  let blankRun = 0
  for (const line of lines) {
    const isBlank = /^\s*$/.test(line)
    if (isBlank) {
      blankRun += 1
      if (blankRun <= max) {
        out.push('')
      }
    } else {
      blankRun = 0
      out.push(line)
    }
  }
  return out.join(eol) + (hadFinalNewline ? eol : '')
}

// ─── expandTabs ─────────────────────────────────────────────────────

export interface ExpandTabsOptions {
  /** Spaces per tab stop. Defaults to `8` (POSIX expand default). */
  tabWidth?: number
}

/**
 *   expandTabs('a\tb', { tabWidth: 4 })   // 'a   b'    (3 spaces → col 4)
 *   expandTabs('foo\tbar')                // 'foo     bar' (5 spaces → col 8)
 *   expandTabs('\thi', { tabWidth: 2 })   // '  hi'
 *
 * A tab advances the cursor to the next multiple of `tabWidth`. The
 * column counter is reset at every newline. Default width matches
 * GNU `expand(1)`. `tabWidth ≤ 0` is treated as `1` (each tab becomes
 * a single space).
 */
export function expandTabs(
  text: string,
  opts: ExpandTabsOptions = {},
): string {
  if (typeof text !== 'string' || text.length === 0) return ''
  const width = Math.max(1, Math.floor(opts.tabWidth ?? 8))
  if (!text.includes('\t')) return text

  const out: string[] = []
  let col = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (ch === '\t') {
      const spaces = width - (col % width)
      out.push(' '.repeat(spaces))
      col += spaces
    } else if (ch === '\n' || ch === '\r') {
      out.push(ch)
      // Carriage return + newline together — treat as a single line break
      // for column-reset purposes but emit both.
      col = 0
    } else {
      out.push(ch)
      col += 1
    }
  }
  return out.join('')
}

// ─── unexpandTabs ───────────────────────────────────────────────────

export interface UnexpandTabsOptions {
  /** Spaces per tab stop. Defaults to `8`. */
  tabWidth?: number
}

/**
 *   unexpandTabs('    hi', { tabWidth: 4 })     // '\thi'
 *   unexpandTabs('        x', { tabWidth: 4 }) // '\t\tx'
 *   unexpandTabs('  hi', { tabWidth: 4 })       // '  hi'  (under one tab)
 *   unexpandTabs('    foo    bar', { tabWidth: 4 })  // '\tfoo    bar'
 *
 * Only leading-whitespace runs are converted (GNU `unexpand(1)`
 * default). A run of `tabWidth` consecutive spaces becomes one tab;
 * any remainder stays as spaces. A leading tab is preserved as a tab,
 * and tabs intermixed with leading spaces are treated as tab-stop
 * boundaries.
 */
export function unexpandTabs(
  text: string,
  opts: UnexpandTabsOptions = {},
): string {
  if (typeof text !== 'string' || text.length === 0) return ''
  const width = Math.max(1, Math.floor(opts.tabWidth ?? 8))

  // Split on LF so per-line leading whitespace can be reprocessed
  // independently. Preserve original line terminators.
  return text.replace(/^[^\S\r\n]*/gm, leading => {
    if (leading.length === 0) return ''
    // Expand the leading run to its column form so a leading tab
    // contributes width-aligned spacing, then group every `width`
    // spaces into a tab.
    const expanded = expandTabs(leading, { tabWidth: width })
    const fullTabs = Math.floor(expanded.length / width)
    const rem = expanded.length - fullTabs * width
    return '\t'.repeat(fullTabs) + ' '.repeat(rem)
  })
}

// ─── dedent ─────────────────────────────────────────────────────────

export interface DedentOptions {
  /**
   * Width to use when expanding tabs in leading indent for the purpose
   * of column comparison. Defaults to `8`. Tabs in leading indent are
   * expanded before computing the common prefix; the stripped prefix is
   * then re-emitted as spaces.
   */
  tabWidth?: number
}

/**
 *   dedent('    line1\n      line2\n    line3\n')
 *     // 'line1\n  line2\nline3\n'
 *
 *   dedent('\thello\n\t\tworld', { tabWidth: 4 })
 *     // 'hello\n    world'
 *
 * Computes the longest leading whitespace prefix common to every
 * non-blank line, then removes that prefix from all lines. Blank
 * lines (whitespace-only) are normalized to fully empty regardless of
 * their original indent.
 *
 * The line-terminator style of the input is preserved (LF stays LF,
 * CRLF stays CRLF).
 */
export function dedent(text: string, opts: DedentOptions = {}): string {
  if (typeof text !== 'string' || text.length === 0) return ''
  const width = Math.max(1, Math.floor(opts.tabWidth ?? 8))

  // Track whether the document uses CRLF so we can re-emit it that way.
  const usesCrlf = /\r\n/.test(text) && !/(?<!\r)\n/.test(text)
  const eol = usesCrlf ? '\r\n' : '\n'

  // Normalize to LF for splitting.
  const lfText = text.replace(/\r\n?/g, '\n')
  const hadFinalNewline = lfText.endsWith('\n')
  const body = hadFinalNewline ? lfText.slice(0, -1) : lfText
  const lines = body.split('\n')

  // Compute common indent across non-blank lines. We measure by
  // expanding tabs to columns, so a leading tab in one line and 8
  // spaces in another contribute the same min count.
  let minIndent = Infinity
  for (const line of lines) {
    if (/^\s*$/.test(line)) continue // blank lines don't constrain
    const leadingMatch = line.match(/^[^\S\r\n]*/)
    const leading = leadingMatch ? leadingMatch[0] : ''
    const expanded = expandTabs(leading, { tabWidth: width })
    if (expanded.length < minIndent) minIndent = expanded.length
    if (minIndent === 0) break
  }
  if (!Number.isFinite(minIndent) || minIndent === 0) {
    // No common indent — only zero-out blank lines and pass through.
    const out = lines.map(l => (/^\s*$/.test(l) ? '' : l))
    return out.join(eol) + (hadFinalNewline ? eol : '')
  }

  const stripCount = minIndent
  const out = lines.map(line => {
    if (/^\s*$/.test(line)) return ''
    const leadingMatch = line.match(/^[^\S\r\n]*/)
    const leading = leadingMatch ? leadingMatch[0] : ''
    const rest = line.slice(leading.length)
    const expanded = expandTabs(leading, { tabWidth: width })
    // Re-emit the line with the leading whitespace expanded to spaces,
    // then drop the first `stripCount` of those.
    return expanded.slice(stripCount) + rest
  })

  return out.join(eol) + (hadFinalNewline ? eol : '')
}

// ─── normalize ──────────────────────────────────────────────────────

export interface NormalizeOptions {
  /** Strip common leading indent. Default `true`. */
  dedent?: boolean
  /** Strip trailing horizontal whitespace from each line. Default `true`. */
  trimTrailing?: boolean
  /**
   * Collapse runs of blank lines. Pass `true` for default
   * (`maxConsecutive=1`), a number to set the cap explicitly, or
   * `false` to disable. Default `true`.
   */
  collapseBlanks?: boolean | number
  /**
   * Normalize line endings. Pass `'lf'`, `'crlf'`, or `false` to skip.
   * Default `'lf'`.
   */
  lineEndings?: LineEndingStyle | false
  /** Trim leading/trailing blank lines. Default `true`. */
  trimEdges?: boolean
  /**
   * Expand tabs to spaces using this tab width. Pass `false` to skip.
   * Default `false` — tab expansion is an opt-in step because most
   * callers want to preserve tabs as a deliberate indentation choice.
   */
  expandTabs?: number | false
  /** Tab width passed through to {@link dedent}. Default `8`. */
  dedentTabWidth?: number
}

/**
 *   normalize('  \n    foo  \n    bar\n\n\n    baz  \n  \n')
 *     // 'foo\nbar\n\nbaz\n'
 *
 * Orchestrates the individual helpers in a fixed order:
 *
 *   1. `expandTabs` (if enabled)
 *   2. `dedent` (if enabled)
 *   3. `trimTrailingWhitespace` (if enabled)
 *   4. `collapseBlankLines` (if enabled)
 *   5. `trimBlankLines` (if `trimEdges`)
 *   6. `normalizeLineEndings` (last, to override any internal style)
 *
 * Every step is independently disable-able via `NormalizeOptions`.
 */
export function normalize(text: string, opts: NormalizeOptions = {}): string {
  if (typeof text !== 'string' || text.length === 0) return ''
  const {
    dedent: doDedent = true,
    trimTrailing = true,
    collapseBlanks = true,
    lineEndings = 'lf',
    trimEdges = true,
    expandTabs: tabWidth = false,
    dedentTabWidth = 8,
  } = opts

  let s = text

  if (tabWidth !== false) {
    s = expandTabs(s, { tabWidth })
  }
  if (doDedent) {
    s = dedent(s, { tabWidth: dedentTabWidth })
  }
  if (trimTrailing) {
    s = trimTrailingWhitespace(s)
  }
  if (collapseBlanks !== false) {
    const max =
      typeof collapseBlanks === 'number'
        ? collapseBlanks
        : /* boolean true */ 1
    s = collapseBlankLines(s, { maxConsecutive: max })
  }
  if (trimEdges) {
    s = trimBlankLines(s)
  }
  if (lineEndings !== false) {
    s = normalizeLineEndings(s, { to: lineEndings })
  }
  return s
}
