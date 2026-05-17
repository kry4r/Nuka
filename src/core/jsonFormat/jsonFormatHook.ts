// src/core/jsonFormat/jsonFormatHook.ts
//
// `afterToolCall` hook that pretty-prints raw compact JSON tool output for
// readability. A common shape is a tool returning
// `[{"a":1,"b":2},{"a":3}]` on a single line; this hook detects that
// pattern and reformats it to multi-line indented JSON via the existing
// `formatJSON` pretty-printer in this directory.
//
// Detection is intentionally conservative — we only attempt to rewrite
// outputs whose first/last non-whitespace characters form a matched
// JSON-container pair (`{}` or `[]`) AND that successfully parse via
// `JSON.parse`. Anything else passes through verbatim. False positives
// would corrupt arbitrary tool output (think `gh pr view` markdown that
// happens to start with a `{` curly bracket in a body), so the parse
// gate is load-bearing — without it, "looks JSON-ish" text would be
// dropped or mutated.
//
// We also skip outputs that are already pretty-printed (contain a
// newline followed by indent whitespace) so re-running the hook on
// previously-formatted output is a no-op. This avoids double-formatting
// when multiple afterToolCall hooks chain.
//
// Replacement uses the `data.replaceResult` contract honoured by
// `wrapWithHooks` (see `core/hooks/wrapTool.ts` step 4a): a successful
// post-hook may return `{ data: { replaceResult: <ToolResult> } }` and the
// wrapper substitutes the surfaced output before the agent sees it.

import type { HookHandler } from '../hooks/events'
import type { ToolResult } from '../tools/types'
import { formatJSON } from './jsonFormat'

/**
 * Behavioural options for {@link createJsonFormatHandler}.
 */
export interface JsonFormatHookConfig {
  /**
   * Restrict the hook to a specific set of tool names. If omitted, the
   * hook considers every tool's output. Matching is exact (case-sensitive),
   * mirroring how the toolName is emitted by `wrapWithHooks`.
   */
  toolNames?: string[]
  /**
   * Minimum byte-length of `output` before the hook attempts a reformat.
   * Very short outputs (e.g. `"ok"` or `{ "x": 1 }`) are already
   * readable; reformatting them adds noise without benefit. Defaults to
   * 80 characters.
   */
  minLength?: number
  /**
   * Maximum byte-length the hook will attempt to parse. JSON-parsing a
   * multi-megabyte string is fast but not free; outputs larger than this
   * pass through unchanged. Defaults to 1,000,000.
   */
  maxLength?: number
  /**
   * Indentation width forwarded to `formatJSON`. Defaults to 2.
   */
  indent?: number
}

export const DEFAULT_JSON_FORMAT_MIN_LENGTH = 80
export const DEFAULT_JSON_FORMAT_MAX_LENGTH = 1_000_000
export const DEFAULT_JSON_FORMAT_INDENT = 2

/**
 * Build an `afterToolCall` handler that pretty-prints raw compact JSON
 * output. Returns a {@link HookHandler}; the caller registers it on the
 * host `HookRegistry`.
 *
 * Behaviour, per call:
 *   - No `payload.result` (the tool threw) → no-op.
 *   - `result.isError === true` → no-op (don't touch error text).
 *   - `result.output` not a string → no-op (ContentBlock[] passes through).
 *   - `config.toolNames` set and `ctx.toolName` not in the list → no-op.
 *   - `output.length` outside `[minLength, maxLength]` → no-op.
 *   - Trimmed output does not start with `{` / `[` and end with the
 *     matching `}` / `]` → no-op.
 *   - Trimmed output already contains a newline followed by indent
 *     whitespace → assume already pretty, no-op.
 *   - `JSON.parse` throws → no-op (treat as not-actually-JSON).
 *   - All gates passed → return
 *     `{ data: { replaceResult: { ...result, output: prettyText } } }`.
 *
 * `isError` is preserved exactly. The hook never escalates a passing
 * tool to an error or downgrades an error to a success.
 */
export function createJsonFormatHandler(
  config: JsonFormatHookConfig = {},
): HookHandler {
  const toolNames = config.toolNames
  const minLength = config.minLength ?? DEFAULT_JSON_FORMAT_MIN_LENGTH
  const maxLength = config.maxLength ?? DEFAULT_JSON_FORMAT_MAX_LENGTH
  const indent = config.indent ?? DEFAULT_JSON_FORMAT_INDENT

  // Pre-compute the allow-set for O(1) name match. Empty/missing means
  // "all tools".
  const allowSet =
    toolNames && toolNames.length > 0 ? new Set(toolNames) : undefined

  return (ctx) => {
    if (allowSet && (!ctx.toolName || !allowSet.has(ctx.toolName))) {
      return {}
    }

    const payload = ctx.payload
    if (payload === undefined) return {}

    const candidate = payload.result
    if (!isToolResult(candidate)) return {}

    // Errors and block-array outputs pass through.
    if (candidate.isError) return {}
    const output = candidate.output
    if (typeof output !== 'string') return {}

    // Length gates — both ends. minLength avoids noisy reformatting of
    // single-line readable JSON; maxLength avoids pathological parse
    // costs on extremely large bodies.
    if (output.length < minLength || output.length > maxLength) return {}

    // Cheap shape check: first/last non-whitespace must form a matched
    // JSON container pair. We scan from each end rather than calling
    // `.trim()` because the result could be many KB; a couple of
    // index probes are dramatically cheaper than allocating a new
    // string. We DO allocate the trimmed slice once below for the
    // already-pretty check, after this gate has filtered the obvious
    // non-JSON cases.
    const firstIdx = firstNonWhitespace(output)
    if (firstIdx < 0) return {}
    const lastIdx = lastNonWhitespace(output, firstIdx)
    const first = output[firstIdx]
    const last = output[lastIdx]
    const isObject = first === '{' && last === '}'
    const isArray = first === '[' && last === ']'
    if (!isObject && !isArray) return {}

    // Already-pretty detection: look for a newline followed by ≥1 space
    // (the indent prefix that `formatJSON` emits). If we already see
    // that, treat the output as previously formatted and skip — running
    // through `JSON.parse` + `formatJSON` again would be a no-op at
    // best and would re-flow inline structures that fit the budget at
    // worst. We deliberately keep this check coarse: any "looks
    // multi-line indented" string is left alone, which is the safer
    // default for a side-effecting rewrite.
    if (/\n[ \t]/.test(output)) return {}

    const trimmed = output.slice(firstIdx, lastIdx + 1)
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      // Conservative: many tool outputs look JSON-ish (e.g. `{foo: 1}` —
      // valid JS, invalid JSON) but don't round-trip through
      // `JSON.parse`. Bail rather than risk a noisy rewrite.
      return {}
    }

    const pretty = formatJSON(parsed, { indent })

    const replacement: ToolResult = {
      ...candidate,
      output: pretty,
    }

    return {
      data: {
        replaceResult: replacement,
        jsonFormat: {
          originalLength: output.length,
          formattedLength: pretty.length,
          indent,
        },
      },
    }
  }
}

/**
 * Internal type guard mirroring the one in `wrapTool.ts` /
 * `autoTruncateHook.ts`. Duplicating it keeps the hook self-contained
 * — both `payload.result` and the consumer side use the same narrowing.
 */
function isToolResult(v: unknown): v is ToolResult {
  if (typeof v !== 'object' || v === null) return false
  const obj = v as Record<string, unknown>
  if (typeof obj.isError !== 'boolean') return false
  return typeof obj.output === 'string' || Array.isArray(obj.output)
}

/** Index of the first non-whitespace char, or -1 if the string is blank. */
function firstNonWhitespace(s: string): number {
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i)
    // ASCII space, tab, LF, CR, VT, FF — the JSON whitespace set is
    // a subset of these; we intentionally accept the broader ASCII
    // whitespace because tool outputs commonly include CR/LF/VT
    // padding around content.
    if (ch !== 0x20 && ch !== 0x09 && ch !== 0x0a && ch !== 0x0d && ch !== 0x0b && ch !== 0x0c) {
      return i
    }
  }
  return -1
}

/** Index of the last non-whitespace char at or after `start`, or `start` if all trailing are blank. */
function lastNonWhitespace(s: string, start: number): number {
  for (let i = s.length - 1; i > start; i--) {
    const ch = s.charCodeAt(i)
    if (ch !== 0x20 && ch !== 0x09 && ch !== 0x0a && ch !== 0x0d && ch !== 0x0b && ch !== 0x0c) {
      return i
    }
  }
  return start
}
