// src/core/truncate/truncateTool.ts
//
// Truncate — agent-facing tool wrapping the pure `truncate.ts` helpers
// into a single discriminated-action surface.
//
// Why a tool? `truncate.ts` exposes grapheme-safe, ANSI-/CJK-aware
// truncation helpers as a pure-logic library (renderers, log dumps,
// tool-result formatters). Without a tool wrapper, the agent has no
// path to it — it would have to fall back to `slice(0, N)` in chat
// (loses tail, splits surrogate pairs, mangles emoji clusters) or
// shell out to `head`/`cut` (no Unicode awareness, no middle-truncate).
// Exposing the existing helpers gives the agent a deterministic,
// side-effect-free "shrink this text" primitive that shares the same
// vocabulary as Nuka's rendering layer.
//
// Why one Tool with `action`, not four narrow ones? Same trade-off as
// FormatDuration / JsonFormat / WrapText / CodeBlocks. The four
// helpers (`truncateMiddle`, `truncateLines`, `truncateToCharBudget`,
// `smartTruncate`) share the same domain (long string → bounded
// string) and most of the same options vocabulary (`maxChars`,
// `ellipsis`). Bundling keeps the registry uncluttered. JSON Schema
// doesn't model proper discriminated unions across action variants,
// so we declare `action` as an enum and validate cross-field
// requirements at runtime (`maxChars` required for middle/budget/smart,
// `maxLines` required for lines, etc.).
//
// Side-effects: none. Pure-logic in, structured payload out. The tool
// is `readOnly: true` and `parallelSafe: true`.
//
// Input shape (discriminated by `action`):
//
//   action: 'middle' requires `text`, `maxChars`
//                    optional `headChars`, `tailChars`, `ellipsis`
//
//   action: 'lines'  requires `text`, `maxLines`
//                    optional `headLines`, `tailLines`, `ellipsis`
//
//   action: 'budget' requires `text`, `maxChars`
//
//   action: 'smart'  requires `text`, `maxChars`
//                    optional `preferLineBoundary`, `preserveCodeFences`
//
// Output: each action returns a structured payload (see TruncateResult
// below) where:
//   - `originalLength` / `resultLength` count grapheme clusters
//     (matching the helper's contract), unless the action is
//     line-oriented, in which case `originalLines` / `resultLines`
//     count `\n`-separated lines.
//   - `truncated` is true iff the result differs from the input (i.e.
//     the budget bit).
//
// The tool's `output` is the JSON-stringified payload so downstream
// consumers (palette, transcripts, sibling agents) can `JSON.parse`
// round-trip.

import type { Tool, ToolContext, ToolResult } from '../tools/types'
import { defineTool } from '../tools/define'
import {
  smartTruncate,
  truncateLines,
  truncateMiddle,
  truncateToCharBudget,
} from './truncate'

export const TRUNCATE_TOOL_NAME = 'Truncate'

/** Allowed `action` discriminator values. */
export type TruncateAction = 'middle' | 'lines' | 'budget' | 'smart'

export type TruncateInput = {
  action: TruncateAction
  /** Required for every action. May be empty string ('' is valid). */
  text: string
  // ── middle / budget / smart ──────────────────────────────────────
  /** Required for action='middle' | 'budget' | 'smart'. Positive integer. */
  maxChars?: number
  // ── middle only ──────────────────────────────────────────────────
  /** Optional. Non-negative integer. */
  headChars?: number
  /** Optional. Non-negative integer. */
  tailChars?: number
  /** Optional. Used by middle + lines as a literal omission marker. */
  ellipsis?: string
  // ── lines only ───────────────────────────────────────────────────
  /** Required for action='lines'. Positive integer. */
  maxLines?: number
  /** Optional. Non-negative integer. */
  headLines?: number
  /** Optional. Non-negative integer. */
  tailLines?: number
  // ── smart only ───────────────────────────────────────────────────
  /** Optional. Default true. */
  preferLineBoundary?: boolean
  /** Optional. Default false. */
  preserveCodeFences?: boolean
}

/**
 * Tagged result payload per action. Char-oriented actions report
 * grapheme counts; line-oriented actions report `\n`-line counts.
 */
export type TruncateResult =
  | {
      action: 'middle' | 'budget' | 'smart'
      result: string
      originalLength: number
      resultLength: number
      truncated: boolean
    }
  | {
      action: 'lines'
      result: string
      originalLines: number
      resultLines: number
      truncated: boolean
    }

const VALID_ACTIONS: ReadonlySet<TruncateAction> = new Set([
  'middle',
  'lines',
  'budget',
  'smart',
])

function errorResult(msg: string): ToolResult {
  return { isError: true, output: `Truncate: ${msg}` }
}

/**
 * Validate that `value` is a positive integer >= 1. Returns the
 * narrowed number or a structured error.
 */
function requirePositiveInt(
  value: unknown,
  field: string,
): { ok: true; value: number } | { ok: false; error: string } {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return {
      ok: false,
      error: `'${field}' must be a finite positive integer (got ${String(value)}).`,
    }
  }
  if (!Number.isInteger(value)) {
    return {
      ok: false,
      error: `'${field}' must be an integer (got ${value}).`,
    }
  }
  if (value < 1) {
    return {
      ok: false,
      error: `'${field}' must be >= 1 (got ${value}).`,
    }
  }
  return { ok: true, value }
}

/**
 * Validate that `value` is a non-negative integer. Returns the
 * narrowed number or a structured error.
 */
function requireNonNegativeInt(
  value: unknown,
  field: string,
): { ok: true; value: number } | { ok: false; error: string } {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return {
      ok: false,
      error: `'${field}' must be a finite non-negative integer (got ${String(value)}).`,
    }
  }
  if (!Number.isInteger(value) || value < 0) {
    return {
      ok: false,
      error: `'${field}' must be a non-negative integer (got ${value}).`,
    }
  }
  return { ok: true, value }
}

// Grapheme-segmenter shared with truncate.ts. We rebuild it here so
// counting in the result doesn't depend on the library's internal
// cache (each module gets one; the cost is one `Intl.Segmenter`
// constructor — a few hundred microseconds, amortised).
let cachedSegmenter: Intl.Segmenter | null = null
function segmenter(): Intl.Segmenter {
  if (!cachedSegmenter) {
    cachedSegmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })
  }
  return cachedSegmenter
}
function graphemeCount(text: string): number {
  if (text === '') return 0
  let count = 0
  for (const _seg of segmenter().segment(text)) count++
  return count
}
function lineCount(text: string): number {
  if (text === '') return 0
  const endsNewline = text.endsWith('\n')
  const parts = text.split('\n')
  return endsNewline ? parts.length - 1 : parts.length
}

/**
 * Build an `(omittedCount: number) => string` callback that ignores
 * the count and emits the caller-supplied literal. Mirrors the way
 * truncate.ts hands the count back into a customizable marker.
 */
function literalEllipsis(literal: string): (n: number) => string {
  return () => literal
}

/**
 * Execute the action and return a structured payload. Exported for
 * tests so they can assert on the shape without going through the
 * Tool's JSON-stringified output channel.
 *
 * Caller-side validation (action enum, required fields, positivity
 * checks) runs inside `run`; this helper assumes already-validated
 * input.
 */
export function runTruncate(input: TruncateInput): TruncateResult {
  switch (input.action) {
    case 'middle': {
      const result = truncateMiddle(input.text, {
        maxChars: input.maxChars as number,
        headChars: input.headChars,
        tailChars: input.tailChars,
        ellipsis:
          input.ellipsis !== undefined
            ? literalEllipsis(input.ellipsis)
            : undefined,
      })
      const originalLength = graphemeCount(input.text)
      const resultLength = graphemeCount(result)
      return {
        action: 'middle',
        result,
        originalLength,
        resultLength,
        truncated: result !== input.text,
      }
    }
    case 'lines': {
      const result = truncateLines(input.text, {
        maxLines: input.maxLines as number,
        headLines: input.headLines,
        tailLines: input.tailLines,
        ellipsis:
          input.ellipsis !== undefined
            ? literalEllipsis(input.ellipsis)
            : undefined,
      })
      const originalLines = lineCount(input.text)
      const resultLines = lineCount(result)
      return {
        action: 'lines',
        result,
        originalLines,
        resultLines,
        truncated: result !== input.text,
      }
    }
    case 'budget': {
      const result = truncateToCharBudget(input.text, input.maxChars as number)
      const originalLength = graphemeCount(input.text)
      const resultLength = graphemeCount(result)
      return {
        action: 'budget',
        result,
        originalLength,
        resultLength,
        truncated: result !== input.text,
      }
    }
    case 'smart': {
      const result = smartTruncate(input.text, {
        maxChars: input.maxChars as number,
        preferLineBoundary: input.preferLineBoundary,
        preserveCodeFences: input.preserveCodeFences,
      })
      const originalLength = graphemeCount(input.text)
      const resultLength = graphemeCount(result)
      return {
        action: 'smart',
        result,
        originalLength,
        resultLength,
        truncated: result !== input.text,
      }
    }
    default: {
      // Exhaustiveness — never reached when validation runs first.
      const _exhaustive: never = input.action
      throw new Error(`unreachable action: ${String(_exhaustive)}`)
    }
  }
}

export const TruncateTool: Tool<TruncateInput> = defineTool<TruncateInput>({
  name: TRUNCATE_TOOL_NAME,
  description:
    "Shrink long text to a bounded length without splitting graphemes or " +
    "losing the tail. Grapheme-safe (Intl.Segmenter), so emoji clusters " +
    "and surrogate pairs survive intact. " +
    "Pick `action`: " +
    "`middle` keeps a head + tail and replaces the centre with a chars- " +
    "omitted marker (good for one-line error/path summaries — options: " +
    "`maxChars`, optional `headChars` / `tailChars`, optional literal " +
    "`ellipsis`); " +
    "`lines` keeps the first N + last M lines and replaces the middle " +
    "with a one-line marker (good for log dumps — options: `maxLines`, " +
    "optional `headLines` / `tailLines`, optional literal `ellipsis`); " +
    "`budget` keeps a prefix up to `maxChars` graphemes, preferring a " +
    "line break in the last 20% of the budget; " +
    "`smart` auto-picks middle vs lines based on the shape of the input " +
    "(options: `preferLineBoundary` default true, `preserveCodeFences` " +
    "to avoid orphaning a ``` opener). " +
    "Pure — no IO, parallel-safe.",
  parameters: {
    type: 'object',
    required: ['action', 'text'],
    properties: {
      action: {
        type: 'string',
        enum: ['middle', 'lines', 'budget', 'smart'],
        description:
          "Which truncation strategy to run. Required fields per action: " +
          "middle/budget/smart -> text+maxChars; lines -> text+maxLines.",
      },
      text: {
        type: 'string',
        description:
          "Input text to truncate. Empty string is allowed (returns empty " +
          "result). Required for every action.",
      },
      maxChars: {
        type: 'number',
        description:
          "Maximum total length in grapheme clusters. Required for " +
          "action='middle' | 'budget' | 'smart'. Must be a positive " +
          "integer (>= 1).",
        minimum: 1,
      },
      headChars: {
        type: 'number',
        description:
          "action='middle': number of grapheme clusters to keep from the " +
          "head. When omitted (with tailChars), head + tail split the " +
          "remaining budget evenly. Must be a non-negative integer.",
        minimum: 0,
      },
      tailChars: {
        type: 'number',
        description:
          "action='middle': number of grapheme clusters to keep from the " +
          "tail. Same default behaviour as `headChars`. Must be a " +
          "non-negative integer.",
        minimum: 0,
      },
      ellipsis: {
        type: 'string',
        description:
          "Optional literal omission marker. Applied to action='middle' " +
          "and action='lines' (replaces the default `…[N chars omitted]…` " +
          "/ `…[N lines omitted]…` markers). The literal is used as-is — " +
          "the omitted-count is not interpolated.",
      },
      maxLines: {
        type: 'number',
        description:
          "Maximum total lines to keep. Required for action='lines'. Must " +
          "be a positive integer (>= 1).",
        minimum: 1,
      },
      headLines: {
        type: 'number',
        description:
          "action='lines': number of head lines to keep. When omitted " +
          "(with tailLines), head + tail split the remaining budget " +
          "evenly. Must be a non-negative integer.",
        minimum: 0,
      },
      tailLines: {
        type: 'number',
        description:
          "action='lines': number of tail lines to keep. Same default " +
          "behaviour as `headLines`. Must be a non-negative integer.",
        minimum: 0,
      },
      preferLineBoundary: {
        type: 'boolean',
        description:
          "action='smart': when true (default), if the input is multi-line " +
          "(>= 4 lines) and crosses the budget, switch to the line-based " +
          "strategy; otherwise middle-truncate.",
      },
      preserveCodeFences: {
        type: 'boolean',
        description:
          "action='smart': when true, if the input contains balanced ``` " +
          "fences that would be split mid-fence, switch to line-truncation " +
          "outside the fence to keep opener + closer together. " +
          "Best-effort — only `` ``` `` fences (not `~~~`) are detected. " +
          "Default false.",
      },
    },
  },
  source: 'builtin',
  tags: ['core', 'truncate', 'format'],
  needsPermission: () => 'none',
  annotations: { readOnly: true, parallelSafe: true },
  searchHint: [
    'truncate',
    'shrink',
    'shorten',
    'clip',
    'ellipsis',
    'omit',
    'budget',
    'grapheme',
  ],
  aliases: ['truncate_text', 'shrink_text'],
  async run(input: TruncateInput, _ctx: ToolContext): Promise<ToolResult> {
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
    if (!VALID_ACTIONS.has(action as TruncateAction)) {
      return errorResult(
        `unknown action '${action}'. Valid: middle, lines, budget, smart.`,
      )
    }

    // ── shared validation: text ───────────────────────────────────────
    if (typeof input.text !== 'string') {
      return errorResult(
        `'text' must be a string (got ${typeof input.text}).`,
      )
    }

    // ── per-action cross-field validation ─────────────────────────────
    switch (action as TruncateAction) {
      case 'middle': {
        const m = requirePositiveInt(input.maxChars, 'maxChars')
        if (!m.ok) return errorResult(`action='middle': ${m.error}`)
        if (input.headChars !== undefined) {
          const v = requireNonNegativeInt(input.headChars, 'headChars')
          if (!v.ok) return errorResult(`action='middle': ${v.error}`)
        }
        if (input.tailChars !== undefined) {
          const v = requireNonNegativeInt(input.tailChars, 'tailChars')
          if (!v.ok) return errorResult(`action='middle': ${v.error}`)
        }
        if (input.ellipsis !== undefined && typeof input.ellipsis !== 'string') {
          return errorResult(
            `action='middle': 'ellipsis' must be a string (got ${typeof input.ellipsis}).`,
          )
        }
        break
      }
      case 'lines': {
        const m = requirePositiveInt(input.maxLines, 'maxLines')
        if (!m.ok) return errorResult(`action='lines': ${m.error}`)
        if (input.headLines !== undefined) {
          const v = requireNonNegativeInt(input.headLines, 'headLines')
          if (!v.ok) return errorResult(`action='lines': ${v.error}`)
        }
        if (input.tailLines !== undefined) {
          const v = requireNonNegativeInt(input.tailLines, 'tailLines')
          if (!v.ok) return errorResult(`action='lines': ${v.error}`)
        }
        if (input.ellipsis !== undefined && typeof input.ellipsis !== 'string') {
          return errorResult(
            `action='lines': 'ellipsis' must be a string (got ${typeof input.ellipsis}).`,
          )
        }
        break
      }
      case 'budget': {
        const m = requirePositiveInt(input.maxChars, 'maxChars')
        if (!m.ok) return errorResult(`action='budget': ${m.error}`)
        break
      }
      case 'smart': {
        const m = requirePositiveInt(input.maxChars, 'maxChars')
        if (!m.ok) return errorResult(`action='smart': ${m.error}`)
        if (
          input.preferLineBoundary !== undefined &&
          typeof input.preferLineBoundary !== 'boolean'
        ) {
          return errorResult(
            `action='smart': 'preferLineBoundary' must be a boolean (got ${typeof input.preferLineBoundary}).`,
          )
        }
        if (
          input.preserveCodeFences !== undefined &&
          typeof input.preserveCodeFences !== 'boolean'
        ) {
          return errorResult(
            `action='smart': 'preserveCodeFences' must be a boolean (got ${typeof input.preserveCodeFences}).`,
          )
        }
        break
      }
    }

    // ── delegate to the pure helper ──────────────────────────────────
    try {
      const payload = runTruncate(input)
      return { isError: false, output: JSON.stringify(payload) }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return errorResult(`action='${action}' failed: ${msg}`)
    }
  },
})
