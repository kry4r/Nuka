// src/core/ansi/ansiStyleTool.ts
//
// AnsiStyleTool — agent-facing tool wrapping the pure `ansiColors.ts`
// (re-exported via `./index`) helpers into a single discriminated-action
// surface.
//
// Why a tool? `ansiColors.ts` is pure library code producing/stripping
// ANSI escape sequences used by Nuka's TUI and log-rendering paths.
// Without a tool wrapper, the agent has to either shell out (`sed`
// regex over `\x1b\[[0-9;]*m`, fragile and incomplete — misses cursor
// moves, hyperlinks, OSC sequences, 256-color or true-color codes,
// non-CSI escapes) or hand-roll the SGR table in chat each time
// (`'\x1b[31m' + text + '\x1b[0m'` invariably ends up using the
// universal reset `0m` which breaks any outer style still in effect).
// Exposing the existing helpers gives the agent a deterministic
// "remove ANSI / apply ANSI" primitive that shares the same vocabulary
// as the TUI renderer.
//
// One Tool with `action`, not three narrow ones: same trade-off as
// WhitespaceTool / CaseConvertTool. The actions (`strip`, `has`,
// `apply`) share the same domain (text in, text or boolean out) and
// a small option vocabulary (the modifier-name enum on `apply`). JSON
// Schema doesn't model proper discriminated unions across action
// variants, so we declare `action` as an enum and validate
// cross-field requirements at runtime.
//
// Side-effects: none. Pure-logic in, structured payload out. The tool
// is `readOnly: true` and `parallelSafe: true`.
//
// Color-toggle interaction: the underlying `style()` honors the
// module-level `colorsEnabled` flag. When the host process is piped
// (no TTY) and `FORCE_COLOR`/`NO_COLOR` are unset, that flag starts
// `false` and `apply` returns the input verbatim. That is the correct
// behavior for production output, but it makes the tool's output
// observability-dependent — the agent calling `apply` may not know
// whether colors are on. We surface the flag in the result payload
// (`colorsEnabled: boolean`) so the caller can branch on it without a
// separate round-trip.
//
// Input shape (discriminated by `action`):
//
//   action: 'strip'   requires `text`                    — remove all ANSI escapes
//   action: 'has'     requires `text`                    — detect ANSI presence
//   action: 'apply'   requires `text` + `style` enum,    — wrap with SGR escapes
//                     optional `extra: StyleName[]`        (compose multiple modifiers)
//
// Output: each action returns a tagged structured payload (see
// AnsiStyleToolResult below). The tool's `output` is the
// JSON-stringified payload so structured consumers (palette,
// transcripts, sibling agents) can `JSON.parse` it round-trip.

import type { Tool, ToolContext, ToolResult } from '../tools/types'
import { defineTool } from '../tools/define'
import { colorsAreEnabled, stripAnsi, style, type StyleName } from './index'

export const ANSI_STYLE_TOOL_NAME = 'AnsiStyle'

/** Allowed `action` discriminator values. */
export type AnsiStyleAction = 'strip' | 'has' | 'apply'

/**
 * Style names accepted by `action='apply'`. This is the public-facing
 * subset matching what's documented on `style()` / `compose()` in
 * `ansiColors.ts` — we re-list the names here so the JSON Schema enum
 * and the runtime validator stay synchronised with the library.
 *
 * Mirrors `StyleName` from `./ansiColors`, restricted to the names
 * the brief explicitly enumerated plus the rest the library exposes
 * for free (bright variants, bg variants, hidden/inverse/strikethrough
 * style modifiers).
 */
const VALID_STYLE_NAMES: ReadonlySet<string> = new Set<StyleName>([
  // Foreground basic 8
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'gray',
  'grey',
  // Foreground bright 8
  'blackBright',
  'redBright',
  'greenBright',
  'yellowBright',
  'blueBright',
  'magentaBright',
  'cyanBright',
  'whiteBright',
  // Background basic 8
  'bgBlack',
  'bgRed',
  'bgGreen',
  'bgYellow',
  'bgBlue',
  'bgMagenta',
  'bgCyan',
  'bgWhite',
  // Background bright 8
  'bgBlackBright',
  'bgRedBright',
  'bgGreenBright',
  'bgYellowBright',
  'bgBlueBright',
  'bgMagentaBright',
  'bgCyanBright',
  'bgWhiteBright',
  // Style modifiers
  'bold',
  'dim',
  'italic',
  'underline',
  'inverse',
  'hidden',
  'strikethrough',
] as const)

/**
 * Flat array form of `VALID_STYLE_NAMES`. Used to populate the JSON
 * Schema `enum` so callers see every accepted modifier name in the
 * tool spec. Kept in the same order as the `Set` initialisation so
 * tests can assert a stable shape if they need to.
 */
const STYLE_ENUM: readonly StyleName[] = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'gray',
  'grey',
  'blackBright',
  'redBright',
  'greenBright',
  'yellowBright',
  'blueBright',
  'magentaBright',
  'cyanBright',
  'whiteBright',
  'bgBlack',
  'bgRed',
  'bgGreen',
  'bgYellow',
  'bgBlue',
  'bgMagenta',
  'bgCyan',
  'bgWhite',
  'bgBlackBright',
  'bgRedBright',
  'bgGreenBright',
  'bgYellowBright',
  'bgBlueBright',
  'bgMagentaBright',
  'bgCyanBright',
  'bgWhiteBright',
  'bold',
  'dim',
  'italic',
  'underline',
  'inverse',
  'hidden',
  'strikethrough',
]

export type AnsiStyleToolInput = {
  action: AnsiStyleAction
  /** Required for every action. */
  text: string
  /** Used by `apply`. Primary modifier — see `STYLE_ENUM`. */
  style?: StyleName
  /**
   * Used by `apply`. Additional modifiers composed *over* `style`
   * (i.e. applied as inner wraps). Useful for `red` + `bold` etc.
   * Each entry must be a member of `STYLE_ENUM`.
   */
  extra?: StyleName[]
}

/** Tagged result payload per action. */
export type AnsiStyleToolResult =
  | {
      action: 'strip'
      result: string
      /** How many characters were stripped (input.length - result.length). */
      stripped: number
    }
  | {
      action: 'has'
      result: boolean
    }
  | {
      action: 'apply'
      result: string
      /** Snapshot of the global color-enabled flag at call time. */
      colorsEnabled: boolean
      /** Modifiers actually applied, in outer→inner order. */
      modifiers: StyleName[]
    }

const VALID_ACTIONS: ReadonlySet<AnsiStyleAction> = new Set([
  'strip',
  'has',
  'apply',
])

function errorResult(msg: string): ToolResult {
  return { isError: true, output: `AnsiStyle: ${msg}` }
}

function isStyleName(value: unknown): value is StyleName {
  return typeof value === 'string' && VALID_STYLE_NAMES.has(value)
}

/**
 * Execute the action and return a structured payload. Exported for
 * tests so they can assert on the shape without going through the
 * Tool's JSON-stringified output channel.
 *
 * Caller-side validation (action enum, required fields, style names)
 * runs inside `run`; this helper assumes already-validated input.
 */
export function runAnsiStyleTool(
  input: AnsiStyleToolInput,
): AnsiStyleToolResult {
  switch (input.action) {
    case 'strip': {
      const result = stripAnsi(input.text)
      return {
        action: 'strip',
        result,
        stripped: input.text.length - result.length,
      }
    }
    case 'has': {
      // `stripAnsi(text) !== text` is the canonical detector: an ANSI
      // escape is exactly what `stripAnsi` removes, so any divergence
      // between the two means at least one escape was present.
      return { action: 'has', result: stripAnsi(input.text) !== input.text }
    }
    case 'apply': {
      // Validation guarantees `style` is set and well-typed; the type
      // assertion is the trade-off for not threading a runtime check
      // through the pure helper.
      const primary = input.style as StyleName
      const extras = input.extra ?? []
      const modifiers: StyleName[] = [primary, ...extras]
      const result = style(input.text, ...modifiers)
      return {
        action: 'apply',
        result,
        colorsEnabled: colorsAreEnabled(),
        modifiers,
      }
    }
    default: {
      // Exhaustiveness — never reached when validation runs first.
      const _exhaustive: never = input.action
      throw new Error(`unreachable action: ${String(_exhaustive)}`)
    }
  }
}

export const AnsiStyleTool: Tool<AnsiStyleToolInput> =
  defineTool<AnsiStyleToolInput>({
    name: ANSI_STYLE_TOOL_NAME,
    description:
      'Strip, detect, or apply ANSI escape sequences on a text string. ' +
      'Pure, no IO. Pick `action`: ' +
      '`strip` removes every ANSI escape (SGR colors, 256-color, ' +
      'true-color, cursor moves, hyperlinks, etc.) — returns `result` ' +
      'and `stripped` (chars removed); ' +
      '`has` returns a boolean — true iff at least one ANSI escape is ' +
      'present in the input; ' +
      '`apply` wraps the text with the SGR sequence for the requested ' +
      '`style` modifier, optionally composed with additional `extra` ' +
      'modifiers (composed outer→inner) — returns `result`, ' +
      '`colorsEnabled` (whether the global toggle was on at call time, ' +
      'since `apply` returns the plain text when the host is non-TTY ' +
      'and `FORCE_COLOR` is unset), and `modifiers` (the actual chain). ' +
      'Pure — no IO, parallel-safe.',
    parameters: {
      type: 'object',
      required: ['action', 'text'],
      properties: {
        action: {
          type: 'string',
          enum: ['strip', 'has', 'apply'],
          description:
            'Which ANSI operation to perform. `strip` and `has` need only ' +
            '`text`; `apply` additionally requires `style` (and optionally ' +
            '`extra`).',
        },
        text: {
          type: 'string',
          description:
            'Input text. Empty string is allowed: `strip` returns `""`, ' +
            "`has` returns `false`, `apply` returns `\"\"` (the library's " +
            'wrap() short-circuits on empty input).',
        },
        style: {
          type: 'string',
          enum: STYLE_ENUM as unknown as string[],
          description:
            "action='apply': primary SGR modifier to wrap the text with. " +
            'One of the documented foreground colors (black, red, green, ' +
            'yellow, blue, magenta, cyan, white, gray/grey), their bright ' +
            'variants (redBright, …), background variants (bgRed, ' +
            'bgRedBright, …), or style modifiers (bold, dim, italic, ' +
            'underline, inverse, hidden, strikethrough).',
        },
        extra: {
          type: 'array',
          items: {
            type: 'string',
            enum: STYLE_ENUM as unknown as string[],
          },
          description:
            "action='apply': additional modifiers composed inner-to-outer " +
            'after the primary `style`. Use for combinations like ' +
            "{style: 'red', extra: ['bold']} -> red bold text.",
        },
      },
    },
    source: 'builtin',
    tags: ['core', 'ansi', 'text', 'format', 'terminal'],
    needsPermission: () => 'none',
    annotations: { readOnly: true, parallelSafe: true },
    searchHint: [
      'ansi',
      'ansiStyle',
      'stripAnsi',
      'color',
      'colour',
      'terminal',
      'sgr',
      'escape',
      'bold',
      'underline',
    ],
    aliases: ['ansi', 'ansi_style', 'strip_ansi'],
    async run(
      input: AnsiStyleToolInput,
      _ctx: ToolContext,
    ): Promise<ToolResult> {
      // ── basic shape check ─────────────────────────────────────────────
      if (input == null || typeof input !== 'object') {
        return errorResult(`input must be an object (got ${String(input)}).`)
      }
      const { action } = input
      if (typeof action !== 'string') {
        return errorResult(
          `'action' must be a string (got ${typeof action}).`,
        )
      }
      if (!VALID_ACTIONS.has(action as AnsiStyleAction)) {
        return errorResult(
          `unknown action '${action}'. Valid: strip, has, apply.`,
        )
      }

      // ── shared validation: text ───────────────────────────────────────
      if (typeof input.text !== 'string') {
        return errorResult(
          `'text' must be a string (got ${typeof input.text}).`,
        )
      }

      // ── per-action / cross-field validation ──────────────────────────
      switch (action as AnsiStyleAction) {
        case 'apply': {
          if (input.style === undefined) {
            return errorResult(
              `action='apply': 'style' is required.`,
            )
          }
          if (!isStyleName(input.style)) {
            return errorResult(
              `action='apply': unknown style '${String(input.style)}'. ` +
                `Valid styles: ${STYLE_ENUM.join(', ')}.`,
            )
          }
          if (input.extra !== undefined) {
            if (!Array.isArray(input.extra)) {
              return errorResult(
                `action='apply': 'extra' must be an array (got ${typeof input.extra}).`,
              )
            }
            for (let i = 0; i < input.extra.length; i++) {
              const entry: unknown = input.extra[i]
              if (!isStyleName(entry)) {
                return errorResult(
                  `action='apply': 'extra[${i}]' is not a valid style ` +
                    `(got ${String(entry)}). Valid styles: ${STYLE_ENUM.join(', ')}.`,
                )
              }
            }
          }
          break
        }
        // 'strip' and 'has' need only `text` validation.
      }

      // ── delegate to the pure helper ──────────────────────────────────
      try {
        const payload = runAnsiStyleTool(input)
        return { isError: false, output: JSON.stringify(payload) }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return errorResult(`action='${action}' failed: ${msg}`)
      }
    },
  })
