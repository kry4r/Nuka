// src/core/duration/duration.ts
//
// Pure millisecond → human-readable duration formatter, inverse parser,
// relative-time formatter, absolute-timestamp formatter, and a small
// bytes-size formatter co-located with them. No React/ink, no LLM, no
// filesystem — just number/Date in, string out (and inverse).
//
// Ported from Nuka-Code `src/utils/format.ts` (`formatDuration`,
// `formatFileSize`, `formatRelativeTime`) and extended with the options
// Nuka asked for (precision, units, compact, verbose, subSecondPrecision,
// parseDuration).
//
// ## Function inventory
//
//   formatDuration         — ms → '1h 23m', '45.6s', '2w 3d', etc.
//   formatDurationApprox   — ms-offset → 'just now', '5s ago', 'in 3 days'
//   formatTimestamp        — Date/number → ISO or short-form absolute string
//   formatBytes            — bytes → '1.2 KB', '3.4 MB', etc.
//   formatFileSize         — alias of formatBytes (upstream name)
//   parseDuration          — string → ms (inverse of formatDuration)
//
// ## Design choices
//
//  - **Unit table.** w/d/h/m/s/ms — weeks down to milliseconds. Months
//    and years are intentionally excluded because they have variable
//    lengths; callers needing those should use `formatTimestamp`. The
//    week unit (`w`) is included because Nuka asked for it (`'2w 3d'`)
//    and because it round-trips cleanly (7d == 1w exactly).
//
//  - **Precision.** Number of units to display, default 2. Trailing
//    zero-valued units are dropped. `precision=1` truncates to the most
//    significant unit (e.g. `'1h 23m 45s'` → `'1h'`). `precision=Infinity`
//    shows all non-zero units.
//
//  - **Sub-second display.** For total < 1s the value is rendered as
//    `'234ms'` (or `'0.5s'` if `subSecondPrecision: false`). For total
//    < 60s with a fractional second component (e.g. 1500ms = 1.5s) we
//    render the seconds value with one decimal place (`'1.5s'`). For
//    total ≥ 60s the seconds are floored — once we've crossed into
//    minute territory the fractional second is not a useful display.
//
//  - **Verbose mode.** `'1 hour 23 minutes 0 seconds'`. Singular vs
//    plural is handled (`'1 hour'` not `'1 hours'`). Trailing zero
//    units are still dropped according to precision rules.
//
//  - **Compact mode.** Drops spaces between units: `'1h23m'`. Mutually
//    independent of verbose (compact verbose is just an oxymoron — we
//    treat `compact` as having no effect when `verbose: true`).
//
//  - **Negative inputs.** Returned with a leading `'-'`. The magnitude
//    is formatted using the same rules, so `formatDuration(-90000)`
//    → `'-1m 30s'`. parseDuration accepts a leading `-` and produces a
//    negative number.
//
//  - **Zero.** `formatDuration(0)` returns `'0s'`. (Upstream behavior.)
//
//  - **parseDuration semantics.** Accepts the output of formatDuration
//    plus loose variants:
//       '1h 30m' / '1h30m' / '1.5h' / '90 minutes' / '2 days 4 hours'
//    Numbers can be decimal. Whitespace between value+unit is optional.
//    Throws `Error('Cannot parse duration: …')` on unparseable input.
//
//  - **formatDurationApprox.** Mirrors upstream `formatRelativeTime`
//    behavior but with a friendlier `'just now'` for < 1s and a
//    standalone `'yesterday'` shorthand for ~24h ago. Past tense uses
//    `'X ago'`; future tense uses `'in X'`. Style is configurable.
//
//  - **formatBytes.** Domain-bridged because tool consumers (file-read,
//    web-fetch) co-locate "ms → string" and "bytes → string" frequently.
//    Uses IEC-style 1024-based units (B / KB / MB / GB / TB) with one
//    decimal place by default. `formatFileSize` is exported as an alias
//    for upstream call-site compatibility (we don't modify upstream
//    consumers, but this preserves the option for future ports).
//
// All functions are pure and have no module-level state.

// ─── unit tables ────────────────────────────────────────────────────

/** Allowed unit identifiers in formatter input/output. */
export type DurationUnit = 'w' | 'd' | 'h' | 'm' | 's' | 'ms'

/**
 * Canonical millisecond conversion for each unit. Frozen so callers can't
 * accidentally mutate at runtime.
 */
export const UNIT_MS: Readonly<Record<DurationUnit, number>> = Object.freeze({
  w: 7 * 24 * 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  h: 60 * 60 * 1000,
  m: 60 * 1000,
  s: 1000,
  ms: 1,
})

/** All units in descending-magnitude order. */
const ALL_UNITS: readonly DurationUnit[] = ['w', 'd', 'h', 'm', 's', 'ms']

/** Short → long unit name (singular). */
const LONG_NAME: Readonly<Record<DurationUnit, string>> = Object.freeze({
  w: 'week',
  d: 'day',
  h: 'hour',
  m: 'minute',
  s: 'second',
  ms: 'millisecond',
})

// ─── formatDuration ─────────────────────────────────────────────────

export interface FormatDurationOptions {
  /**
   * Number of unit segments to display. Default `2`. Use `Infinity` or
   * any large finite number for "show all non-zero units". `precision=1`
   * truncates to the most-significant unit.
   */
  precision?: number
  /**
   * Allowed units. Default `['w', 'd', 'h', 'm', 's', 'ms']`. Units not
   * in this list are folded into the nearest allowed larger unit (or
   * remainder discarded for sub-second when 'ms' is excluded).
   */
  units?: readonly DurationUnit[]
  /**
   * When `true` (default), totals below 1s render as `'234ms'` and
   * non-integer seconds below 60s render as `'1.5s'`. When `false`,
   * everything below 1s renders as `'0.2s'` and fractional seconds are
   * floored.
   */
  subSecondPrecision?: boolean
  /** Drop spaces between units: `'1h23m'`. Default `false`. */
  compact?: boolean
  /** Use long names: `'1 hour 23 minutes'`. Default `false`. */
  verbose?: boolean
  /**
   * Drop trailing zero-valued segments before reaching `precision`.
   * Default `true`. When `false`, padding zeros are kept up to
   * `precision`.
   */
  trimTrailingZeros?: boolean
}

/**
 *   formatDuration(234)          // '234ms'
 *   formatDuration(1500)         // '1.5s'
 *   formatDuration(45_000)       // '45s'
 *   formatDuration(60_000)       // '1m'
 *   formatDuration(90_000)       // '1m 30s'
 *   formatDuration(3_600_000)    // '1h'
 *   formatDuration(86_400_000)   // '1d'
 *   formatDuration(0)            // '0s'
 *   formatDuration(-90_000)      // '-1m 30s'
 *   formatDuration(90_000, { compact: true })  // '1m30s'
 *   formatDuration(90_000, { verbose: true })  // '1 minute 30 seconds'
 *   formatDuration(3_723_000, { precision: 1 })   // '1h'
 *   formatDuration(3_723_000, { precision: 3 })   // '1h 2m 3s'
 *
 * Edge cases:
 *  - `NaN` → `'NaN'` (so callers can spot bad input downstream).
 *  - `Infinity` / `-Infinity` → `'Infinity'` / `'-Infinity'`.
 */
export function formatDuration(
  ms: number,
  opts: FormatDurationOptions = {},
): string {
  if (!Number.isFinite(ms)) {
    if (Number.isNaN(ms)) return 'NaN'
    return ms > 0 ? 'Infinity' : '-Infinity'
  }
  if (ms === 0) return formatZero(opts)

  const negative = ms < 0
  let remaining = negative ? -ms : ms

  const precision = Math.max(
    1,
    Number.isFinite(opts.precision)
      ? Math.floor(opts.precision as number)
      : opts.precision === Infinity
        ? ALL_UNITS.length
        : 2,
  )
  const units = filterUnits(opts.units ?? ALL_UNITS)
  const subSecond = opts.subSecondPrecision ?? true
  const compact = opts.compact ?? false
  const verbose = opts.verbose ?? false
  const trim = opts.trimTrailingZeros ?? true

  // ── sub-second / sub-minute decimal special cases ───────────────
  // Only kick in when 'ms' or 's' is the smallest available unit and
  // subSecondPrecision is enabled and we're not in verbose mode (verbose
  // prefers full long-form: "1 second" not "1.5 seconds" decimal).
  if (subSecond && remaining < 1000 && units.includes('ms')) {
    // Pure-ms display: `'234ms'`.
    const sign = negative ? '-' : ''
    const value = Math.round(remaining)
    if (verbose) {
      return `${sign}${pluralize(value, 'ms', verbose)}`
    }
    return `${sign}${value}ms`
  }
  if (
    subSecond &&
    remaining < 60_000 &&
    remaining % 1000 !== 0 &&
    units.includes('s') &&
    !verbose
  ) {
    // 1.5s, 45.6s
    const sign = negative ? '-' : ''
    const seconds = remaining / 1000
    // One decimal place, drop trailing '.0'
    const str = seconds.toFixed(1).replace(/\.0$/, '')
    return `${sign}${str}s`
  }

  // ── general path: walk units from largest to smallest ───────────
  const segments: Array<{ unit: DurationUnit; value: number }> = []
  for (const u of units) {
    const ms1 = UNIT_MS[u]
    const value = Math.floor(remaining / ms1)
    if (value > 0 || segments.length > 0) {
      segments.push({ unit: u, value })
      remaining -= value * ms1
    }
    if (segments.length >= precision) break
  }

  if (segments.length === 0) {
    // Whole-input was smaller than any allowed unit. Fall back to the
    // smallest allowed unit with value rounded.
    const smallest = units[units.length - 1] ?? 's'
    const value = Math.round(ms / UNIT_MS[smallest])
    segments.push({ unit: smallest, value })
  }

  let pruned = segments.slice(0, precision)
  if (trim) {
    while (pruned.length > 1 && pruned[pruned.length - 1]!.value === 0) {
      pruned.pop()
    }
  }

  const sign = negative ? '-' : ''
  const sep = verbose ? ' ' : compact ? '' : ' '
  const rendered = pruned
    .map(seg => renderSegment(seg.unit, seg.value, verbose))
    .join(sep)
  return `${sign}${rendered}`
}

function formatZero(opts: FormatDurationOptions): string {
  if (opts.verbose) return '0 seconds'
  return '0s'
}

function renderSegment(unit: DurationUnit, value: number, verbose: boolean): string {
  if (verbose) {
    return pluralize(value, unit, true)
  }
  return `${value}${unit}`
}

function pluralize(value: number, unit: DurationUnit, verbose: boolean): string {
  if (!verbose) return `${value}${unit}`
  const long = LONG_NAME[unit]
  const word = value === 1 ? long : `${long}s`
  return `${value} ${word}`
}

function filterUnits(units: readonly DurationUnit[]): readonly DurationUnit[] {
  // Preserve descending-magnitude order regardless of input order; drop
  // dupes; ignore anything not in the canonical set.
  const set = new Set<DurationUnit>()
  for (const u of units) {
    if (UNIT_MS[u] !== undefined) set.add(u)
  }
  const ordered = ALL_UNITS.filter(u => set.has(u))
  if (ordered.length === 0) return ALL_UNITS
  return ordered
}

// ─── parseDuration ──────────────────────────────────────────────────

/**
 * Long-form aliases the parser accepts in addition to the short tokens
 * above (`w`, `d`, `h`, `m`, `s`, `ms`).
 */
const PARSE_ALIASES: Readonly<Record<string, DurationUnit>> = Object.freeze({
  // ms first so 'msec' / 'millisecond' match before single-letter 'm'
  ms: 'ms',
  msec: 'ms',
  msecs: 'ms',
  millisecond: 'ms',
  milliseconds: 'ms',
  s: 's',
  sec: 's',
  secs: 's',
  second: 's',
  seconds: 's',
  m: 'm',
  min: 'm',
  mins: 'm',
  minute: 'm',
  minutes: 'm',
  h: 'h',
  hr: 'h',
  hrs: 'h',
  hour: 'h',
  hours: 'h',
  d: 'd',
  day: 'd',
  days: 'd',
  w: 'w',
  wk: 'w',
  wks: 'w',
  week: 'w',
  weeks: 'w',
})

/** Token pattern: `123`, `1.5`, optional whitespace, then a unit alias. */
const TOKEN_RE = /(-?\d+(?:\.\d+)?)\s*([a-zA-Z]+)/g

/**
 *   parseDuration('1h 30m')        // 5400000
 *   parseDuration('1.5h')          // 5400000
 *   parseDuration('90 minutes')    // 5400000
 *   parseDuration('234ms')         // 234
 *   parseDuration('1d 2h 30m 15s') // 95415000
 *   parseDuration('-1h')           // -3600000
 *
 * Throws on unparseable input.
 */
export function parseDuration(text: string): number {
  if (typeof text !== 'string') {
    throw new Error(`Cannot parse duration: ${typeof text}`)
  }
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    throw new Error('Cannot parse duration: empty string')
  }

  // Whole-string sign handling: leading `-` flips the result. Inner
  // negative tokens (e.g. `-30s` inside `1h -30s`) are kept literally so
  // expressions like `'1h -30s'` round-trip to 30 minutes — uncommon but
  // mathematically consistent with the per-token sign.
  let negate = false
  let body = trimmed
  if (body.startsWith('-')) {
    negate = true
    body = body.slice(1).trim()
  } else if (body.startsWith('+')) {
    body = body.slice(1).trim()
  }

  // First try the regex-based tokenizer.
  TOKEN_RE.lastIndex = 0
  const matches: Array<{ value: number; unit: DurationUnit }> = []
  let lastIndex = 0
  let consumedAny = false
  let m: RegExpExecArray | null
  while ((m = TOKEN_RE.exec(body)) !== null) {
    const [whole, numStr, unitStr] = m
    if (m.index < lastIndex) {
      // overlap shouldn't happen, but be safe
      break
    }
    // The text between lastIndex and m.index must be whitespace or
    // separator only — otherwise we have garbage in between tokens
    // (e.g. `'1h foo 30m'`).
    const gap = body.slice(lastIndex, m.index)
    if (gap.length > 0 && !/^[\s,+]*$/.test(gap)) {
      throw new Error(`Cannot parse duration: unexpected '${gap.trim()}' in '${text}'`)
    }
    const value = Number(numStr)
    if (!Number.isFinite(value)) {
      throw new Error(`Cannot parse duration: bad number '${numStr}' in '${text}'`)
    }
    const unit = PARSE_ALIASES[unitStr!.toLowerCase()]
    if (!unit) {
      throw new Error(`Cannot parse duration: unknown unit '${unitStr}' in '${text}'`)
    }
    matches.push({ value, unit })
    lastIndex = m.index + (whole as string).length
    consumedAny = true
  }
  // Tail must also be whitespace-only.
  const tail = body.slice(lastIndex)
  if (tail.length > 0 && !/^[\s,+]*$/.test(tail)) {
    throw new Error(`Cannot parse duration: trailing '${tail.trim()}' in '${text}'`)
  }
  if (!consumedAny) {
    throw new Error(`Cannot parse duration: '${text}'`)
  }

  let total = 0
  for (const { value, unit } of matches) {
    total += value * UNIT_MS[unit]
  }
  return negate ? -total : total
}

// ─── formatDurationApprox ───────────────────────────────────────────

export interface FormatDurationApproxOptions {
  /**
   * Reference time for "ago" / "in" calculations. Defaults to
   * `Date.now()`. Override for testability.
   */
  now?: number
  /**
   * `'short'` (default) → `'5s ago'`, `'in 2m'`.
   * `'long'`             → `'5 seconds ago'`, `'in 2 minutes'`.
   */
  style?: 'short' | 'long'
  /**
   * Threshold (ms) below which we report `'just now'` (past) or
   * `'in a moment'` (future). Default 1000.
   */
  justNowThreshold?: number
}

/**
 *   formatDurationApprox(0)              // 'just now'  (when delta=0)
 *   formatDurationApprox(-500)           // 'just now'  (sub-second past)
 *   formatDurationApprox(-5_000)         // '5s ago'
 *   formatDurationApprox(5_000)          // 'in 5s'
 *   formatDurationApprox(-3_600_000)     // '1h ago'
 *   formatDurationApprox(-86_400_000)    // 'yesterday'
 *   formatDurationApprox(86_400_000)     // 'tomorrow'
 *   formatDurationApprox(-3 * 86_400_000) // '3 days ago' (long style: same)
 *
 * The signed input represents "target - now": positive = future,
 * negative = past. Pass `target - opts.now` from your caller. When
 * called with the default `now`, you can instead pass `target -
 * Date.now()` directly.
 */
export function formatDurationApprox(
  deltaMs: number,
  opts: FormatDurationApproxOptions = {},
): string {
  if (!Number.isFinite(deltaMs)) {
    return formatDuration(deltaMs)
  }
  const style = opts.style ?? 'short'
  const justNow = Math.max(0, opts.justNowThreshold ?? 1000)
  const abs = Math.abs(deltaMs)

  if (abs < justNow) return 'just now'

  // Yesterday / tomorrow: within +/- 36 hours of the 24h mark.
  const oneDay = UNIT_MS.d
  if (deltaMs <= -oneDay * 0.75 && deltaMs >= -oneDay * 1.5) {
    return 'yesterday'
  }
  if (deltaMs >= oneDay * 0.75 && deltaMs <= oneDay * 1.5) {
    return 'tomorrow'
  }

  const formatted = formatDuration(abs, {
    precision: 1,
    verbose: style === 'long',
    subSecondPrecision: false,
  })
  return deltaMs < 0 ? `${formatted} ago` : `in ${formatted}`
}

// ─── formatTimestamp ────────────────────────────────────────────────

export interface FormatTimestampOptions {
  /**
   * `'iso'` (default) → `'2026-05-17T13:45:00.000Z'`.
   * `'short'`         → `'2026-05-17 13:45:00'` (UTC).
   * `'date'`          → `'2026-05-17'` (UTC).
   * `'time'`          → `'13:45:00'` (UTC).
   */
  style?: 'iso' | 'short' | 'date' | 'time'
}

/**
 *   formatTimestamp(new Date(0))                  // '1970-01-01T00:00:00.000Z'
 *   formatTimestamp(0, { style: 'short' })        // '1970-01-01 00:00:00'
 *   formatTimestamp(0, { style: 'date' })         // '1970-01-01'
 *   formatTimestamp(0, { style: 'time' })         // '00:00:00'
 *
 * Always operates in UTC for deterministic output regardless of system
 * timezone — caller can format locally if they need that.
 */
export function formatTimestamp(
  date: Date | number,
  opts: FormatTimestampOptions = {},
): string {
  const d = typeof date === 'number' ? new Date(date) : date
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
    throw new Error(`formatTimestamp: invalid date input`)
  }
  const style = opts.style ?? 'iso'
  const iso = d.toISOString() // 'YYYY-MM-DDTHH:MM:SS.sssZ'
  if (style === 'iso') return iso
  if (style === 'date') return iso.slice(0, 10) // YYYY-MM-DD
  if (style === 'time') return iso.slice(11, 19) // HH:MM:SS
  // 'short' → YYYY-MM-DD HH:MM:SS
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`
}

// ─── formatBytes / formatFileSize ───────────────────────────────────

export interface FormatBytesOptions {
  /**
   * Number of decimal places. Default `1`. Whole-unit values still drop
   * the `'.0'` suffix unless `keepTrailingZero` is set.
   */
  decimals?: number
  /** Keep `'1.0 KB'` instead of dropping to `'1 KB'`. Default `false`. */
  keepTrailingZero?: boolean
  /**
   * Use a space between value and unit. Default `true`. When `false`
   * → `'1.2KB'`.
   */
  space?: boolean
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const

/**
 *   formatBytes(0)         // '0 B'
 *   formatBytes(1023)      // '1023 B'
 *   formatBytes(1024)      // '1 KB'
 *   formatBytes(1536)      // '1.5 KB'
 *   formatBytes(1_500_000) // '1.4 MB'
 *
 * Negative byte counts are returned with a `-` prefix. Non-finite
 * inputs (`NaN`, `Infinity`) follow `formatDuration` conventions and
 * are returned as the string of their special value.
 */
export function formatBytes(
  bytes: number,
  opts: FormatBytesOptions = {},
): string {
  if (!Number.isFinite(bytes)) {
    if (Number.isNaN(bytes)) return 'NaN'
    return bytes > 0 ? 'Infinity' : '-Infinity'
  }
  const decimals = Math.max(0, Math.floor(opts.decimals ?? 1))
  const keepZero = opts.keepTrailingZero ?? false
  const space = opts.space ?? true
  const sep = space ? ' ' : ''

  const negative = bytes < 0
  let n = negative ? -bytes : bytes

  // Below 1024 → render as integer "N B"
  if (n < 1024) {
    return `${negative ? '-' : ''}${Math.round(n)}${sep}B`
  }

  let unitIdx = 0
  while (n >= 1024 && unitIdx < BYTE_UNITS.length - 1) {
    n = n / 1024
    unitIdx += 1
  }

  let str = n.toFixed(decimals)
  if (!keepZero && decimals > 0) {
    str = str.replace(/\.?0+$/, '')
    // Edge case: 0.00 → '' after the replace; keep at least '0'
    if (str === '' || str === '-') str = '0'
  }
  return `${negative ? '-' : ''}${str}${sep}${BYTE_UNITS[unitIdx]}`
}

/** Alias of {@link formatBytes} for upstream call-site parity. */
export const formatFileSize = formatBytes
