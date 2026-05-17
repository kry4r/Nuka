// src/core/wordWrap/wrapTextTool.ts
//
// WrapText — agent-facing tool wrapping the pure `wordWrap.ts` helpers
// into a single discriminated-action surface.
//
// Why a tool? `wordWrap.ts` exposes display-width-aware wrap helpers as
// a pure-logic library (renderers, tool-summary formatters, blockquote
// prefixers). Without a tool, the agent has no path to it and has to
// either ask `Bash` for `fold(1)` (no ANSI/CJK awareness, no
// hanging-indent / prefix model) or hand-wrap text in chat (slow,
// drifts past column budgets, can't honour fullwidth glyphs). Exposing
// the existing helper gives the agent a deterministic, side-effect-free
// "flow this text into N columns" primitive that shares the same
// vocabulary as Nuka's renderers.
//
// One Tool with `action`, not two narrow ones: same trade-off as
// FormatDuration / JsonFormat / CodeBlocks. The two helpers
// (`wrapText`, `wrapWithPrefix`) share the same domain (string ->
// width-bounded string) and most of the same options vocabulary
// (`width`, `breakWord`, `preserveNewlines`). Bundling keeps the
// registry uncluttered. JSON Schema doesn't model proper discriminated
// unions across action variants, so we declare `action` as an enum and
// validate cross-field requirements at runtime (`firstPrefix` /
// `continuationPrefix` required for `wrapWithPrefix`, etc.).
//
// Side-effects: none. Pure-logic in, structured payload out. The tool
// is `readOnly: true` and `parallelSafe: true`.
//
// Input shape (discriminated by `action`):
//
//   action: 'wrap'           requires `text`, `width`
//                            optional `breakWord`, `indent`,
//                            `hangingIndent`, `preserveNewlines`
//
//   action: 'wrapWithPrefix' requires `text`, `width`, `firstPrefix`,
//                            `continuationPrefix`
//
// Output: each action returns a tagged structured payload (see
// WrapTextResult below). The tool's `output` is the JSON-stringified
// payload so structured consumers (palette, transcripts, downstream
// agents) can `JSON.parse` it round-trip.

import type { Tool, ToolContext, ToolResult } from '../tools/types'
import { defineTool } from '../tools/define'
import { stringWidth } from '../stringWidth'
import { wrapText, wrapWithPrefix } from './wordWrap'

export const WRAP_TEXT_TOOL_NAME = 'WrapText'

/** Allowed `action` discriminator values. */
export type WrapTextAction = 'wrap' | 'wrapWithPrefix'

export type WrapTextInput = {
  action: WrapTextAction
  /** Required for every action. May be empty string ('' is valid). */
  text: string
  /** Required for every action. Positive integer >= 1. */
  width: number
  // ── wrap-specific options ───────────────────────────────────────────
  /** Hard-break long words at grapheme boundaries. Default false. */
  breakWord?: boolean
  /** Cells of indentation applied to every output line. Default 0. */
  indent?: number
  /** Extra indentation on continuation lines. Default 0. */
  hangingIndent?: number
  /** Preserve input `\n` boundaries as paragraph separators. Default true. */
  preserveNewlines?: boolean
  // ── wrapWithPrefix-specific options ─────────────────────────────────
  /** Prefix on the first line of each paragraph. Required for action='wrapWithPrefix'. */
  firstPrefix?: string
  /** Prefix on continuation lines of each paragraph. Required for action='wrapWithPrefix'. */
  continuationPrefix?: string
}

/** Tagged result payload per action. */
export type WrapTextResult =
  | {
      action: 'wrap'
      result: string
      lines: string[]
      maxLineWidth: number
    }
  | {
      action: 'wrapWithPrefix'
      result: string
      lines: string[]
    }

const VALID_ACTIONS: ReadonlySet<WrapTextAction> = new Set([
  'wrap',
  'wrapWithPrefix',
])

function errorResult(msg: string): ToolResult {
  return { isError: true, output: `WrapText: ${msg}` }
}

/**
 * Validate that `value` is a positive integer >= 1. Returns the
 * narrowed number or a structured error.
 */
function requirePositiveIntWidth(
  value: unknown,
): { ok: true; value: number } | { ok: false; error: string } {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return {
      ok: false,
      error: `'width' must be a finite positive integer (got ${String(value)}).`,
    }
  }
  if (!Number.isInteger(value)) {
    return {
      ok: false,
      error: `'width' must be an integer (got ${value}).`,
    }
  }
  if (value < 1) {
    return {
      ok: false,
      error: `'width' must be >= 1 (got ${value}).`,
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

/**
 * Execute the action and return a structured payload. Exported for
 * tests so they can assert on the shape without going through the
 * Tool's JSON-stringified output channel.
 *
 * Caller-side validation (action enum, required fields, width >= 1)
 * runs inside `run`; this helper assumes already-validated input.
 */
export function runWrapText(input: WrapTextInput): WrapTextResult {
  if (input.action === 'wrap') {
    const result = wrapText(input.text, {
      width: input.width,
      breakWord: input.breakWord,
      indent: input.indent,
      hangingIndent: input.hangingIndent,
      preserveNewlines: input.preserveNewlines,
    })
    // `lines` is computed by splitting the result. `wrapText` returns
    // `\n`-joined output, so a split round-trips one-to-one to the
    // underlying `wrapLines` output. Even an empty input collapses to
    // [''] (see wrapLines), which split('') would mishandle — but
    // wrapText('', ...) returns '' which splits to [''], matching.
    const lines = result.split('\n')
    let maxLineWidth = 0
    for (const line of lines) {
      const w = stringWidth(line)
      if (w > maxLineWidth) maxLineWidth = w
    }
    return { action: 'wrap', result, lines, maxLineWidth }
  }
  // action === 'wrapWithPrefix'
  const result = wrapWithPrefix(input.text, {
    width: input.width,
    firstPrefix: input.firstPrefix as string,
    continuationPrefix: input.continuationPrefix as string,
  })
  const lines = result.split('\n')
  return { action: 'wrapWithPrefix', result, lines }
}

export const WrapTextTool: Tool<WrapTextInput> = defineTool<WrapTextInput>({
  name: WRAP_TEXT_TOOL_NAME,
  description:
    "Wrap text to fit a terminal column budget. Display-width aware: " +
    "ANSI escapes are zero-width, CJK / fullwidth glyphs count as 2, " +
    "ZWJ emoji and combining marks land on the right column. " +
    "Pick `action`: " +
    "`wrap` flows text into `width` cells per line (options: `breakWord` " +
    "hard-splits overlong words at grapheme boundaries, `indent` indents " +
    "every line, `hangingIndent` indents continuation lines only, " +
    "`preserveNewlines` treats input `\\n` as paragraph breaks); " +
    "`wrapWithPrefix` prepends `firstPrefix` to first line and " +
    "`continuationPrefix` to continuation lines of each paragraph " +
    "(blockquotes, bulleted lists). " +
    "Pure — no IO, parallel-safe.",
  parameters: {
    type: 'object',
    required: ['action', 'text', 'width'],
    properties: {
      action: {
        type: 'string',
        enum: ['wrap', 'wrapWithPrefix'],
        description:
          "Which wrap variant to run. `wrap` -> wrapText(); " +
          "`wrapWithPrefix` -> wrapWithPrefix(). Required fields per " +
          "action: wrap -> text+width; wrapWithPrefix -> text+width+" +
          "firstPrefix+continuationPrefix.",
      },
      text: {
        type: 'string',
        description:
          "Input text to wrap. Empty string is allowed (returns empty " +
          "result). Required for both actions.",
      },
      width: {
        type: 'number',
        description:
          "Target column budget per line in terminal cells. Must be a " +
          "positive integer (>= 1). Required for both actions.",
        minimum: 1,
      },
      breakWord: {
        type: 'boolean',
        description:
          "action='wrap': hard-break words wider than the budget at a " +
          "grapheme boundary (no surrogate-pair / emoji-cluster splits). " +
          "Default false (overlong words sit on their own line and " +
          "overflow, matching the 'don't mangle a URL' contract).",
      },
      indent: {
        type: 'number',
        description:
          "action='wrap': cells of leading indentation applied to every " +
          "output line. Default 0. Must be a non-negative integer.",
        minimum: 0,
      },
      hangingIndent: {
        type: 'number',
        description:
          "action='wrap': additional cells of leading indentation on the " +
          "SECOND and subsequent lines of each paragraph (useful for " +
          "list-style output). Stacks additively with `indent`. Default " +
          "0. Must be a non-negative integer.",
        minimum: 0,
      },
      preserveNewlines: {
        type: 'boolean',
        description:
          "action='wrap': treat input `\\n` as paragraph boundaries " +
          "(default true). When false, newlines are flattened to single " +
          "spaces and the input is flowed as one paragraph.",
      },
      firstPrefix: {
        type: 'string',
        description:
          "action='wrapWithPrefix': prefix prepended to the FIRST line " +
          "of every paragraph (e.g. '> ' for blockquote, '- ' for " +
          "bullet). Required for wrapWithPrefix. The prefix's display " +
          "width is subtracted from `width` so prefix + content fits.",
      },
      continuationPrefix: {
        type: 'string',
        description:
          "action='wrapWithPrefix': prefix prepended to SECOND and " +
          "subsequent lines of every paragraph (e.g. '> ' for " +
          "blockquote, '  ' to align under a bullet). Required for " +
          "wrapWithPrefix.",
      },
    },
  },
  source: 'builtin',
  tags: ['core', 'wordWrap', 'format'],
  needsPermission: () => 'none',
  annotations: { readOnly: true, parallelSafe: true },
  searchHint: [
    'wrap',
    'wordwrap',
    'word-wrap',
    'fold',
    'reflow',
    'columns',
    'width',
    'blockquote',
    'prefix',
  ],
  aliases: ['wrap_text', 'word_wrap'],
  async run(input: WrapTextInput, _ctx: ToolContext): Promise<ToolResult> {
    // ── basic shape check ─────────────────────────────────────────────
    if (input == null || typeof input !== 'object') {
      return errorResult(
        `input must be an object (got ${String(input)}).`,
      )
    }
    const { action } = input
    if (typeof action !== 'string') {
      return errorResult(
        `'action' must be a string (got ${typeof action}).`,
      )
    }
    if (!VALID_ACTIONS.has(action as WrapTextAction)) {
      return errorResult(
        `unknown action '${action}'. Valid: wrap, wrapWithPrefix.`,
      )
    }

    // ── shared validation: text + width ───────────────────────────────
    if (typeof input.text !== 'string') {
      return errorResult(
        `'text' must be a string (got ${typeof input.text}).`,
      )
    }
    const w = requirePositiveIntWidth(input.width)
    if (!w.ok) {
      return errorResult(w.error)
    }

    // ── per-action cross-field validation ─────────────────────────────
    switch (action as WrapTextAction) {
      case 'wrap': {
        if (input.indent !== undefined) {
          const v = requireNonNegativeInt(input.indent, 'indent')
          if (!v.ok) return errorResult(`action='wrap': ${v.error}`)
        }
        if (input.hangingIndent !== undefined) {
          const v = requireNonNegativeInt(input.hangingIndent, 'hangingIndent')
          if (!v.ok) return errorResult(`action='wrap': ${v.error}`)
        }
        break
      }
      case 'wrapWithPrefix': {
        if (typeof input.firstPrefix !== 'string') {
          return errorResult(
            `action='wrapWithPrefix': 'firstPrefix' is required (got ${typeof input.firstPrefix}).`,
          )
        }
        if (typeof input.continuationPrefix !== 'string') {
          return errorResult(
            `action='wrapWithPrefix': 'continuationPrefix' is required (got ${typeof input.continuationPrefix}).`,
          )
        }
        break
      }
    }

    // ── delegate to the pure helper ──────────────────────────────────
    try {
      const payload = runWrapText(input)
      return { isError: false, output: JSON.stringify(payload) }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return errorResult(`action='${action}' failed: ${msg}`)
    }
  },
})
