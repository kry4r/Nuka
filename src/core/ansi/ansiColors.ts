// src/core/ansi/ansiColors.ts
//
// ANSI escape-sequence generation. Pure logic — no React/ink, no LLM,
// no filesystem (env vars and stdout TTY probes only, read once at
// module load). The module is the *producer* of ANSI sequences; the
// existing `src/core/stringWidth/` is the *consumer* (its `stripAnsi`
// and width math undo / measure the output this module produces).
//
// ## Why hand-rolled rather than `chalk`?
//
// `chalk` is already a Nuka dep, but its public surface is built
// around method-chaining (`chalk.red.bold.bgBlue('x')`) and a global
// `level` register that's awkward to reset for tests. We want:
//
//   1. A flat, tree-shakeable function-per-color surface so partial
//      bundles don't drag in the full SGR table.
//   2. Deterministic per-call output that doesn't depend on a
//      mutable global level — easier to snapshot-test and reason
//      about.
//   3. A run-time toggle (`enableColors()` / `disableColors()`) that
//      flips a single boolean read inside `wrap()`, with no chalk
//      reinitialization gymnastics.
//   4. Direct exposure of the raw SGR codes (RESET, etc.) so callers
//      can compose with other ANSI tooling without re-implementing
//      the escape-string machinery.
//
// SGR table reference: ECMA-48 § 8.3.117 (CSI Ps... m). We implement
// the universally-supported subset:
//
//   • Codes 30-37: foreground basic 8 colors
//   • Codes 40-47: background basic 8 colors
//   • Codes 90-97: foreground bright 8 colors (aixterm extension,
//                  but supported everywhere modern)
//   • Codes 100-107: background bright 8 colors
//   • Code 38;5;N: foreground from the 256-color palette
//   • Code 48;5;N: background from the 256-color palette
//   • Code 38;2;R;G;B: foreground true-color (24-bit)
//   • Code 48;2;R;G;B: background true-color
//   • Codes 1, 2, 3, 4, 7, 8, 9: bold, dim, italic, underline,
//                                inverse, hidden, strikethrough
//
// Cursor / screen control is intentionally minimal — just the four
// operations the TUI actually reaches for (`clearLine`, `clearScreen`,
// `moveTo`, `cursorHide` / `cursorShow`). Anything more belongs in a
// proper terminal abstraction.
//
// ## Nested-style invariant
//
// Closing an SGR group with `\x1b[0m` (full reset) breaks any outer
// style still in effect. We use the *minimal* per-attribute closing
// codes (`\x1b[39m` for default foreground, `\x1b[49m` for default
// background, `\x1b[22m` to leave bold/dim, etc.) so that
// `red(green('x'))` correctly returns to red after the inner span.
//
// ## Color-detection contract
//
//   • `NO_COLOR` set (any value, per https://no-color.org)  → off
//   • `FORCE_COLOR=0` or `false`                            → off
//   • `FORCE_COLOR=1` / `2` / `3` / `true` / unset value    → on
//   • Else: `process.stdout.isTTY` / `process.stderr.isTTY`
//
// The check runs once at module load. Tests that need a different
// initial value should `enableColors()` / `disableColors()` rather
// than re-import — Node ESM caches the module graph.
//
// ## Bail-out reminder for future callers
//
// If you find yourself wanting nested-bracket parsing, gradient
// strings, theme objects, or chaining DSLs — STOP and use `chalk`
// directly. This module is intentionally tiny.

export { stripAnsi } from '../stringWidth/index'

/** Escape character — `\x1b` / `ESC`. */
const ESC = '\x1b'

/** Generic Control Sequence Introducer prefix. */
const CSI = `${ESC}[`

/** Universal SGR reset: clears every attribute at once. */
export const RESET = `${CSI}0m`

/**
 * Build an SGR sequence: `\x1b[<params>m`. Internal helper, but
 * exported so callers can compose arbitrary codes (e.g. with a
 * codepage shift) without re-implementing the prefix.
 */
export function sgr(params: number | string): string {
  return `${CSI}${params}m`
}

// ─── Color-detection ──────────────────────────────────────────────

interface SupportsColor {
  /** Whether stdout currently honors color escapes. */
  stdout: boolean
  /** Whether stderr currently honors color escapes. */
  stderr: boolean
}

function detectStream(stream: NodeJS.WriteStream | undefined): boolean {
  const env = process.env
  if (env['NO_COLOR'] !== undefined) return false
  const force = env['FORCE_COLOR']
  if (force !== undefined) {
    const v = force.toLowerCase()
    if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false
    return true
  }
  return stream?.isTTY === true
}

/**
 * Lazily-computed per-stream color support. Read at most once per
 * stream per process; the boolean is then cached. Tests that flip
 * env vars should call `refreshSupportsColor()` to invalidate.
 */
export const supportsColor: SupportsColor = {
  get stdout() {
    return detectStream(process.stdout)
  },
  get stderr() {
    return detectStream(process.stderr)
  },
}

// ─── Global on/off toggle ─────────────────────────────────────────

/**
 * Initial state: follows `supportsColor.stdout` (the channel most
 * TUI / log output targets). Override at runtime with
 * `enableColors()` / `disableColors()`.
 */
let colorsEnabled = supportsColor.stdout

/** Force colors on, regardless of TTY detection. */
export function enableColors(): void {
  colorsEnabled = true
}

/** Force colors off — all helpers return plain text. */
export function disableColors(): void {
  colorsEnabled = false
}

/** Inspect the current toggle. Mostly useful in tests. */
export function colorsAreEnabled(): boolean {
  return colorsEnabled
}

/**
 * Re-probe `process.env` / `process.stdout.isTTY` and reset
 * `colorsEnabled` to that value. Useful in tests that mutate
 * `NO_COLOR` / `FORCE_COLOR` to assert env-respect behavior.
 */
export function refreshSupportsColor(): void {
  colorsEnabled = supportsColor.stdout
}

// ─── SGR opening / closing pairs ─────────────────────────────────

/**
 * Each entry maps a logical color/style name to its `[open, close]`
 * SGR pair. Closing codes are the *attribute-specific* reset (e.g.
 * `39` for default foreground), not the universal `0`, so nested
 * styles don't blow away the outer style.
 */
interface SgrPair {
  open: string
  close: string
}

// ─── Foreground basic 8 (codes 30-37, close 39) ──────────────────
const FG: Record<string, SgrPair> = {
  black: { open: sgr(30), close: sgr(39) },
  red: { open: sgr(31), close: sgr(39) },
  green: { open: sgr(32), close: sgr(39) },
  yellow: { open: sgr(33), close: sgr(39) },
  blue: { open: sgr(34), close: sgr(39) },
  magenta: { open: sgr(35), close: sgr(39) },
  cyan: { open: sgr(36), close: sgr(39) },
  white: { open: sgr(37), close: sgr(39) },
  gray: { open: sgr(90), close: sgr(39) },
  grey: { open: sgr(90), close: sgr(39) },
}

// ─── Foreground bright 8 (codes 90-97, close 39) ─────────────────
const FG_BRIGHT: Record<string, SgrPair> = {
  blackBright: { open: sgr(90), close: sgr(39) },
  redBright: { open: sgr(91), close: sgr(39) },
  greenBright: { open: sgr(92), close: sgr(39) },
  yellowBright: { open: sgr(93), close: sgr(39) },
  blueBright: { open: sgr(94), close: sgr(39) },
  magentaBright: { open: sgr(95), close: sgr(39) },
  cyanBright: { open: sgr(96), close: sgr(39) },
  whiteBright: { open: sgr(97), close: sgr(39) },
}

// ─── Background basic 8 (codes 40-47, close 49) ──────────────────
const BG: Record<string, SgrPair> = {
  bgBlack: { open: sgr(40), close: sgr(49) },
  bgRed: { open: sgr(41), close: sgr(49) },
  bgGreen: { open: sgr(42), close: sgr(49) },
  bgYellow: { open: sgr(43), close: sgr(49) },
  bgBlue: { open: sgr(44), close: sgr(49) },
  bgMagenta: { open: sgr(45), close: sgr(49) },
  bgCyan: { open: sgr(46), close: sgr(49) },
  bgWhite: { open: sgr(47), close: sgr(49) },
}

// ─── Background bright 8 (codes 100-107, close 49) ───────────────
const BG_BRIGHT: Record<string, SgrPair> = {
  bgBlackBright: { open: sgr(100), close: sgr(49) },
  bgRedBright: { open: sgr(101), close: sgr(49) },
  bgGreenBright: { open: sgr(102), close: sgr(49) },
  bgYellowBright: { open: sgr(103), close: sgr(49) },
  bgBlueBright: { open: sgr(104), close: sgr(49) },
  bgMagentaBright: { open: sgr(105), close: sgr(49) },
  bgCyanBright: { open: sgr(106), close: sgr(49) },
  bgWhiteBright: { open: sgr(107), close: sgr(49) },
}

// ─── Style modifiers ─────────────────────────────────────────────
//
// `bold` and `dim` both close with 22 (per ECMA-48: 22 = "normal
// intensity"). `inverse` (7) closes with 27, `hidden` (8) with 28,
// `strikethrough` (9) with 29.
const STYLE: Record<string, SgrPair> = {
  bold: { open: sgr(1), close: sgr(22) },
  dim: { open: sgr(2), close: sgr(22) },
  italic: { open: sgr(3), close: sgr(23) },
  underline: { open: sgr(4), close: sgr(24) },
  inverse: { open: sgr(7), close: sgr(27) },
  hidden: { open: sgr(8), close: sgr(28) },
  strikethrough: { open: sgr(9), close: sgr(29) },
}

// ─── Style name type & lookup ───────────────────────────────────

/** All single-name style strings accepted by `style()` / `compose()`. */
export type StyleName =
  | keyof typeof FG
  | keyof typeof FG_BRIGHT
  | keyof typeof BG
  | keyof typeof BG_BRIGHT
  | keyof typeof STYLE

const ALL_PAIRS: Record<string, SgrPair> = {
  ...FG,
  ...FG_BRIGHT,
  ...BG,
  ...BG_BRIGHT,
  ...STYLE,
}

// ─── Core wrap ───────────────────────────────────────────────────

/**
 * Wrap `text` with `pair.open` / `pair.close`. When colors are
 * disabled, returns the text unchanged.
 *
 * Re-applies `pair.open` after every inner `pair.close` so nested
 * spans don't break the outer color: e.g. for the outer `red`,
 * after the inner `green` resets to default-fg, we re-emit
 * `\x1b[31m` so the rest of the outer span keeps glowing red.
 */
function wrap(text: string, pair: SgrPair): string {
  if (!colorsEnabled) return text
  if (text.length === 0) return ''
  if (text.indexOf(pair.close) !== -1) {
    // Re-open after every nested close of the same kind.
    const reopened = text.split(pair.close).join(pair.close + pair.open)
    return pair.open + reopened + pair.close
  }
  return pair.open + text + pair.close
}

// ─── Public color helpers ────────────────────────────────────────

function maker(pair: SgrPair): (text: string) => string {
  return (text: string) => wrap(text, pair)
}

export const black: (text: string) => string = maker(FG['black']!)
export const red: (text: string) => string = maker(FG['red']!)
export const green: (text: string) => string = maker(FG['green']!)
export const yellow: (text: string) => string = maker(FG['yellow']!)
export const blue: (text: string) => string = maker(FG['blue']!)
export const magenta: (text: string) => string = maker(FG['magenta']!)
export const cyan: (text: string) => string = maker(FG['cyan']!)
export const white: (text: string) => string = maker(FG['white']!)
export const gray: (text: string) => string = maker(FG['gray']!)
export const grey: (text: string) => string = maker(FG['grey']!)

export const blackBright: (text: string) => string = maker(FG_BRIGHT['blackBright']!)
export const redBright: (text: string) => string = maker(FG_BRIGHT['redBright']!)
export const greenBright: (text: string) => string = maker(FG_BRIGHT['greenBright']!)
export const yellowBright: (text: string) => string = maker(FG_BRIGHT['yellowBright']!)
export const blueBright: (text: string) => string = maker(FG_BRIGHT['blueBright']!)
export const magentaBright: (text: string) => string = maker(FG_BRIGHT['magentaBright']!)
export const cyanBright: (text: string) => string = maker(FG_BRIGHT['cyanBright']!)
export const whiteBright: (text: string) => string = maker(FG_BRIGHT['whiteBright']!)

export const bgBlack: (text: string) => string = maker(BG['bgBlack']!)
export const bgRed: (text: string) => string = maker(BG['bgRed']!)
export const bgGreen: (text: string) => string = maker(BG['bgGreen']!)
export const bgYellow: (text: string) => string = maker(BG['bgYellow']!)
export const bgBlue: (text: string) => string = maker(BG['bgBlue']!)
export const bgMagenta: (text: string) => string = maker(BG['bgMagenta']!)
export const bgCyan: (text: string) => string = maker(BG['bgCyan']!)
export const bgWhite: (text: string) => string = maker(BG['bgWhite']!)

export const bgBlackBright: (text: string) => string = maker(BG_BRIGHT['bgBlackBright']!)
export const bgRedBright: (text: string) => string = maker(BG_BRIGHT['bgRedBright']!)
export const bgGreenBright: (text: string) => string = maker(BG_BRIGHT['bgGreenBright']!)
export const bgYellowBright: (text: string) => string = maker(BG_BRIGHT['bgYellowBright']!)
export const bgBlueBright: (text: string) => string = maker(BG_BRIGHT['bgBlueBright']!)
export const bgMagentaBright: (text: string) => string = maker(BG_BRIGHT['bgMagentaBright']!)
export const bgCyanBright: (text: string) => string = maker(BG_BRIGHT['bgCyanBright']!)
export const bgWhiteBright: (text: string) => string = maker(BG_BRIGHT['bgWhiteBright']!)

// ─── Style modifiers ─────────────────────────────────────────────

export const bold: (text: string) => string = maker(STYLE['bold']!)
export const dim: (text: string) => string = maker(STYLE['dim']!)
export const italic: (text: string) => string = maker(STYLE['italic']!)
export const underline: (text: string) => string = maker(STYLE['underline']!)
export const inverse: (text: string) => string = maker(STYLE['inverse']!)
export const hidden: (text: string) => string = maker(STYLE['hidden']!)
export const strikethrough: (text: string) => string = maker(STYLE['strikethrough']!)

// ─── 256-color palette ───────────────────────────────────────────

function assertPaletteIndex(code: number, fnName: string): void {
  if (!Number.isInteger(code) || code < 0 || code > 255) {
    throw new RangeError(
      `${fnName}: code must be an integer in [0, 255], got ${code}`,
    )
  }
}

/** Foreground from the xterm 256-color palette. `code` must be 0..255. */
export function color256(text: string, code: number): string {
  assertPaletteIndex(code, 'color256')
  return wrap(text, { open: sgr(`38;5;${code}`), close: sgr(39) })
}

/** Background from the xterm 256-color palette. `code` must be 0..255. */
export function color256Bg(text: string, code: number): string {
  assertPaletteIndex(code, 'color256Bg')
  return wrap(text, { open: sgr(`48;5;${code}`), close: sgr(49) })
}

// ─── True-color (24-bit RGB) ─────────────────────────────────────

function assertChannel(value: number, name: string, fnName: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new RangeError(
      `${fnName}: ${name} channel must be an integer in [0, 255], got ${value}`,
    )
  }
}

/** Foreground RGB true-color. Each channel must be 0..255. */
export function rgb(text: string, r: number, g: number, b: number): string {
  assertChannel(r, 'r', 'rgb')
  assertChannel(g, 'g', 'rgb')
  assertChannel(b, 'b', 'rgb')
  return wrap(text, { open: sgr(`38;2;${r};${g};${b}`), close: sgr(39) })
}

/** Background RGB true-color. Each channel must be 0..255. */
export function rgbBg(text: string, r: number, g: number, b: number): string {
  assertChannel(r, 'r', 'rgbBg')
  assertChannel(g, 'g', 'rgbBg')
  assertChannel(b, 'b', 'rgbBg')
  return wrap(text, { open: sgr(`48;2;${r};${g};${b}`), close: sgr(49) })
}

// ─── Composition ─────────────────────────────────────────────────

function lookupPair(name: StyleName): SgrPair {
  const pair = ALL_PAIRS[name]
  if (!pair) {
    throw new TypeError(`Unknown style name: ${String(name)}`)
  }
  return pair
}

/**
 * Apply multiple modifiers in order. Composed open codes are emitted
 * outer→inner, close codes are emitted inner→outer, so each pair
 * stays balanced and nested resets don't break outer state.
 *
 *     style('hi', 'red', 'bold')
 *     // → '\x1b[31m\x1b[1mhi\x1b[22m\x1b[39m'
 */
export function style(text: string, ...modifiers: StyleName[]): string {
  if (modifiers.length === 0) return text
  let out = text
  // Apply right-to-left so the leftmost modifier ends up outermost
  // — matches the visual intent of `style(t, 'red', 'bold')`
  // (i.e. "red bold text", where red is the outer property).
  for (let i = modifiers.length - 1; i >= 0; i--) {
    out = wrap(out, lookupPair(modifiers[i]!))
  }
  return out
}

/**
 * Pre-build a reusable styler for the given modifiers. The returned
 * function captures the modifier list at compose-time but reads the
 * `colorsEnabled` flag at call-time, so toggling colors on/off after
 * composition still works.
 *
 *     const warn = compose('yellow', 'bold')
 *     warn('careful')   // ANSI-wrapped
 *     disableColors()
 *     warn('careful')   // plain
 */
export function compose(
  ...modifiers: StyleName[]
): (text: string) => string {
  // Validate up-front so the compose call fails fast on a typo.
  const pairs = modifiers.map(lookupPair)
  return (text: string): string => {
    if (pairs.length === 0) return text
    let out = text
    for (let i = pairs.length - 1; i >= 0; i--) {
      out = wrap(out, pairs[i]!)
    }
    return out
  }
}

// ─── Cursor / screen control (minimal subset) ────────────────────
//
// These return *escape sequences*, not styled text. Callers write
// them directly to stdout. We expose only the four operations the
// TUI actually uses today; richer terminal control belongs in a
// dedicated module.
//
// Honor `colorsEnabled` for consistency — when colors are off
// (e.g. piped output), suppress cursor / screen control too, since
// the consumer is almost certainly not a terminal anyway. Callers
// that need to emit these unconditionally can read the raw constants.

/** Clear the entire current line (CSI 2K). */
export function clearLine(): string {
  return colorsEnabled ? `${CSI}2K` : ''
}

/** Clear the entire screen and reset cursor to home (CSI 2J then CSI H). */
export function clearScreen(): string {
  return colorsEnabled ? `${CSI}2J${CSI}H` : ''
}

/**
 * Move the cursor to a 1-based (row, column). Coordinates are
 * clamped to a non-negative integer; out-of-range values throw
 * (terminals' real bounds depend on the live window size, which
 * this pure-logic module doesn't probe).
 */
export function moveTo(row: number, col: number): string {
  if (!Number.isInteger(row) || row < 1) {
    throw new RangeError(`moveTo: row must be a positive integer, got ${row}`)
  }
  if (!Number.isInteger(col) || col < 1) {
    throw new RangeError(`moveTo: col must be a positive integer, got ${col}`)
  }
  return colorsEnabled ? `${CSI}${row};${col}H` : ''
}

/** Hide the cursor (DECTCEM off). */
export function cursorHide(): string {
  return colorsEnabled ? `${CSI}?25l` : ''
}

/** Show the cursor (DECTCEM on). */
export function cursorShow(): string {
  return colorsEnabled ? `${CSI}?25h` : ''
}
