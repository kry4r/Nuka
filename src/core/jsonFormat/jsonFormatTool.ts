// src/core/jsonFormat/jsonFormatTool.ts
//
// JsonFormat — agent-facing tool wrapping the pure `jsonFormat.ts`
// pretty-printer into a single callable surface.
//
// Why a tool? `jsonFormat.ts` exposes `formatJSON` / `formatJSONCompact`
// as a pure-logic library — it is the right abstraction inside the
// codebase (renderers, prompt-context snippets, log dumps), but the
// agent has no direct path to it. Without a tool, the model has to
// either ask `Bash` for a `node -e 'JSON.stringify(...)'` round-trip
// (lossy, no inline-vs-multiline budget, no depth/array/string caps,
// no cycle handling) or hand-format the structure in chat (slow,
// error-prone, eats context). Exposing the existing helper gives the
// agent a deterministic, side-effect-free "show me this object in
// human-legible form" primitive that knows the same vocabulary as
// the rest of Nuka's rendering layer.
//
// Why a single Tool with discriminated input instead of two? The
// underlying surface is two functions (`formatJSON`, `formatJSONCompact`)
// but they share the same conceptual operation (value → pretty string)
// and the same options vocabulary. The Tool exposes `compact: true` as
// a single boolean flag that routes to `formatJSONCompact`; everything
// else flows into `formatJSON`. Keeps the registry uncluttered.
//
// Input shape (value XOR valueText):
//
//   • `value`       — any JSON-serializable value (object, array,
//                     string, number, boolean, null). Used directly.
//   • `valueText`   — a JSON string that the tool will `JSON.parse`
//                     first. Useful when the caller already has the
//                     value as text (e.g., from a previous tool's
//                     output channel).
//
// Exactly one of `value` / `valueText` must be present. The pair forms
// an XOR — both means ambiguity, neither means nothing to format.
//
// Output: a tagged structured payload (see JsonFormatResult). The
// tool's `output` is the JSON-stringified payload so downstream
// consumers can round-trip `JSON.parse` on it.
//
// Marker tags from `JsonMarkers` are deliberately NOT exposed — the
// agent has no use case for ANSI/HTML wrapping and exposing the
// surface would invite escape-injection mistakes. Same for the
// `cycleHandler` / `bigintHandler` / `nonFiniteAsString` knobs: the
// pure-helper defaults (`'placeholder'`, `'string'`, `false`) are the
// right behaviour for an agent-facing dump.
//
// Side-effects: none. `readOnly: true`, `parallelSafe: true`.

import type { Tool, ToolContext, ToolResult } from '../tools/types'
import { defineTool } from '../tools/define'
import {
  formatJSON,
  formatJSONCompact,
  type FormatJSONOptions,
} from './jsonFormat'

export const JSON_FORMAT_TOOL_NAME = 'JsonFormat'

/** Input accepted by the tool. `value` XOR `valueText` is enforced at runtime. */
export type JsonFormatInput = {
  /** A JSON-serializable value. Mutually exclusive with `valueText`. */
  value?: unknown
  /** A JSON string the tool will parse before formatting. Mutually exclusive with `value`. */
  valueText?: string
  /** Indentation width in spaces. Default 2. */
  indent?: number
  /** Inline-fit budget (soft column width). Default 80. */
  maxLineLength?: number
  /** Maximum nesting depth before ellipsis. Default Infinity. */
  maxDepth?: number
  /** Maximum array length before truncation. Default Infinity. */
  maxArrayLength?: number
  /** Maximum string length before inline truncation. Default Infinity. */
  maxStringLength?: number
  /** Sort object keys alphabetically. Default false. */
  sortKeys?: boolean
  /** If true, force inline output via `formatJSONCompact`. */
  compact?: boolean
}

/**
 * Tagged result. `inputType` tells the caller whether the value came
 * from `value` (direct) or `valueText` (parsed). `truncationsApplied`
 * is a hint for the caller: it is `true` when any of the cap options
 * left a marker (`"…"`, `"…, +N more"`, `"…+N"`) in the rendered
 * output. Mirrors the cap markers emitted by `jsonFormat.ts`.
 */
export type JsonFormatResult = {
  result: string
  inputType: 'value' | 'valueText'
  truncationsApplied?: boolean
}

function errorResult(msg: string): ToolResult {
  return { isError: true, output: `JsonFormat: ${msg}` }
}

/**
 * Map our (agent-facing, narrow) input shape into the (richer,
 * library-facing) `FormatJSONOptions`. Keeps the agent surface small
 * while leaving room for library callers to use the full helper.
 */
function buildOptions(input: JsonFormatInput): FormatJSONOptions {
  const opts: FormatJSONOptions = {}
  if (input.indent !== undefined) opts.indent = input.indent
  if (input.maxLineLength !== undefined) opts.maxLineLength = input.maxLineLength
  if (input.maxDepth !== undefined) opts.maxDepth = input.maxDepth
  if (input.maxArrayLength !== undefined) opts.maxArrayLength = input.maxArrayLength
  if (input.maxStringLength !== undefined) opts.maxStringLength = input.maxStringLength
  if (input.sortKeys !== undefined) opts.sortKeys = input.sortKeys
  return opts
}

/**
 * Detect whether the rendered output bears any of the truncation
 * markers emitted by `jsonFormat.ts`. The library emits:
 *
 *   • `"…"`       — at-or-past maxDepth
 *   • `"…, +N more"` — array truncated by maxArrayLength
 *   • `"…+N"` inside a quoted string — string truncated by
 *                  maxStringLength (note: no comma before the +N,
 *                  so the array-truncation marker is excluded by
 *                  the comma test).
 *
 * False positive risk: a user-supplied string containing the literal
 * ellipsis character could trip the check. That is accepted — the
 * field is a hint, not a guarantee, and the only consumer is a
 * downstream agent deciding whether to ask for more detail.
 */
function detectTruncations(rendered: string): boolean {
  // Either an array-truncation marker, a depth-truncation literal
  // (`"…"` as its own token), or an in-string truncation tail (`…+`
  // followed by digits, before the closing quote).
  return (
    rendered.includes('…, +') ||
    rendered.includes('"…"') ||
    /…\+\d+/.test(rendered)
  )
}

/**
 * Execute the format. Exported for tests so they can assert on the
 * shape without going through the JSON-stringified output channel.
 *
 * Caller-side validation (XOR of `value`/`valueText`, parse-error
 * propagation) runs inside `run`; this helper assumes a normalised
 * input where `value` is the resolved JS value to format.
 */
export function runJsonFormat(
  value: unknown,
  inputType: 'value' | 'valueText',
  input: JsonFormatInput,
): JsonFormatResult {
  const opts = buildOptions(input)
  const rendered = input.compact
    ? formatJSONCompact(value)
    : formatJSON(value, opts)
  return {
    result: rendered,
    inputType,
    truncationsApplied: detectTruncations(rendered),
  }
}

export const JsonFormatTool: Tool<JsonFormatInput> = defineTool<JsonFormatInput>({
  name: JSON_FORMAT_TOOL_NAME,
  description:
    "Pretty-print a JSON value into a human-legible formatted string. " +
    "Pass `value` for an already-parsed JS value, OR `valueText` for a JSON " +
    "string (which the tool will parse first). Exactly one of the two is required. " +
    "Options: `indent` (default 2), `maxLineLength` (inline-vs-multiline budget, " +
    "default 80), `maxDepth` (ellipsis past depth), `maxArrayLength` (truncate " +
    "long arrays), `maxStringLength` (truncate long strings), `sortKeys` " +
    "(alphabetical key order), `compact` (single-line output). " +
    "Pure — no IO, parallel-safe. Prefer this over Bash + node JSON.stringify.",
  parameters: {
    type: 'object',
    properties: {
      value: {
        description:
          "A JSON-serializable value to pretty-print. Mutually exclusive with " +
          "`valueText` — provide exactly one.",
      },
      valueText: {
        type: 'string',
        description:
          "A JSON string. The tool will `JSON.parse` it before formatting. " +
          "On parse error, returns a structured `invalid JSON` error. " +
          "Mutually exclusive with `value` — provide exactly one.",
      },
      indent: {
        type: 'number',
        description:
          "Indentation width in spaces. Default 2. 0 forces compact output " +
          "regardless of `maxLineLength`.",
        minimum: 0,
      },
      maxLineLength: {
        type: 'number',
        description:
          "Soft column budget. Arrays/objects whose single-line form fits this " +
          "width stay inline; longer ones expand to multi-line. Default 80.",
        minimum: 0,
      },
      maxDepth: {
        type: 'number',
        description:
          "Maximum nesting depth before nodes are replaced with '…'. Root is " +
          "depth 0. Default Infinity (no truncation).",
        minimum: 0,
      },
      maxArrayLength: {
        type: 'number',
        description:
          "Maximum array length. Longer arrays show their first N elements then " +
          "'…, +K more'. Default Infinity (no truncation).",
        minimum: 0,
      },
      maxStringLength: {
        type: 'number',
        description:
          "Maximum string length (characters). Longer strings are truncated inline " +
          "with a '…+K' suffix inside the quotes. Default Infinity.",
        minimum: 0,
      },
      sortKeys: {
        type: 'boolean',
        description:
          "If true, object keys are emitted in alphabetical order. Default false " +
          "(insertion order, matching JSON.stringify).",
      },
      compact: {
        type: 'boolean',
        description:
          "If true, force a single-line (compact) rendering using formatJSONCompact. " +
          "Overrides `maxLineLength`. Default false.",
      },
    },
  },
  source: 'builtin',
  tags: ['core', 'jsonFormat', 'format'],
  needsPermission: () => 'none',
  annotations: { readOnly: true, parallelSafe: true },
  searchHint: [
    'json',
    'format',
    'pretty',
    'stringify',
    'dump',
    'render',
  ],
  aliases: ['format_json', 'json_format', 'pretty_json'],
  async run(input: JsonFormatInput, _ctx: ToolContext): Promise<ToolResult> {
    // ── basic shape check ─────────────────────────────────────────
    if (input == null || typeof input !== 'object') {
      return errorResult(
        `input must be an object (got ${String(input)}).`,
      )
    }

    // ── XOR enforcement: value / valueText ────────────────────────
    // `value` is intentionally untyped (any JSON-serializable). The
    // shape check is "the key is present" — `undefined` counts as
    // absent (matches the schema's optionality), `null` counts as
    // present (it is a legal JSON value).
    const hasValue =
      Object.prototype.hasOwnProperty.call(input, 'value') &&
      input.value !== undefined
    const hasText = typeof input.valueText === 'string'

    if (!hasValue && !hasText) {
      return errorResult(
        `exactly one of 'value' or 'valueText' must be provided.`,
      )
    }
    if (hasValue && hasText) {
      return errorResult(
        `'value' and 'valueText' are mutually exclusive — provide exactly one.`,
      )
    }

    // ── option validation (numeric fields must be finite ≥ 0) ─────
    const numFields: (keyof JsonFormatInput)[] = [
      'indent',
      'maxLineLength',
      'maxDepth',
      'maxArrayLength',
      'maxStringLength',
    ]
    for (const f of numFields) {
      const v = input[f] as unknown
      if (v === undefined) continue
      // `Infinity` is allowed for the cap fields — `formatJSON` reads
      // it as "no truncation". `indent` and `maxLineLength` are
      // clamped/handled by `resolveOptions` so any finite or Infinity
      // value is fine there too. The only thing we reject here is
      // non-numeric (e.g. string) and NaN.
      if (typeof v !== 'number' || Number.isNaN(v)) {
        return errorResult(
          `option '${String(f)}' must be a number (got ${typeof v}).`,
        )
      }
      if (v < 0) {
        return errorResult(
          `option '${String(f)}' must be >= 0 (got ${v}).`,
        )
      }
    }

    // ── resolve the value to format ──────────────────────────────
    let resolvedValue: unknown
    let inputType: 'value' | 'valueText'

    if (hasText) {
      inputType = 'valueText'
      try {
        resolvedValue = JSON.parse(input.valueText as string)
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        // Structured error: caller can branch on 'invalid JSON' vs
        // a generic runtime failure. Wrapped in a top-level error
        // payload so the agent loop renders the message faithfully.
        return errorResult(`invalid JSON in 'valueText': ${detail}`)
      }
    } else {
      inputType = 'value'
      resolvedValue = input.value
    }

    // ── delegate to the pure helper ──────────────────────────────
    try {
      const payload = runJsonFormat(resolvedValue, inputType, input)
      return { isError: false, output: JSON.stringify(payload) }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return errorResult(`format failed: ${msg}`)
    }
  },
})
