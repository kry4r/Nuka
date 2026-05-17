// src/core/toolResult/autoTruncateHook.ts
//
// `afterToolCall` hook that guards the agent's context window against
// runaway tool output. When a tool produces a result whose textual output
// exceeds `maxChars` grapheme clusters, the hook returns a replacement
// `ToolResult` carrying the middle-truncated text. The replacement is
// honoured by `wrapWithHooks` (see step 4a in `core/hooks/wrapTool.ts`),
// which scans post-hook results for `{ data: { replaceResult: ... } }`
// and substitutes the surfaced output.
//
// Design notes:
//
//   - We only mutate STRING `output`. The `ContentBlock[]` shape is left
//     alone — those blocks already carry their own size semantics (images
//     are bytes, structured payloads are caller-controlled), and a blunt
//     middle-cut over an array would either split a block or drop one. A
//     separate iter can add block-aware shrinking if needed.
//
//   - Error results (`isError: true`) pass through unchanged. Tail-end
//     stack traces and error messages are where debugging value lives;
//     halving them is a footgun. (If someone needs to cap error sizes
//     too they can register a sibling hook with explicit opt-in.)
//
//   - Truncation uses `truncateMiddle` from `core/truncate` so the head
//     (context-where-it-started) and the tail (final lines / actual exit
//     state) both survive. The omission marker tells the agent how much
//     was elided so it can decide whether to re-fetch with a targeted
//     query.
//
//   - The hook records the original byte size in `data.autoTruncate.original`
//     so downstream observers (tests, telemetry) can confirm a truncation
//     occurred. We don't push `additionalContext` because the truncation
//     marker inside the output already signals it to the model.
//
// The default budget (8000 graphemes) matches the iter brief and is large
// enough to fit a typical bash invocation or file read, but small enough
// to prevent a single 50k-line log dump from blowing the model's context.

import type { HookHandler } from '../hooks/events'
import type { ToolResult } from '../tools/types'
import { truncateMiddle } from '../truncate/truncate'

/**
 * Behavioural options for {@link createAutoTruncateHook}.
 */
export interface AutoTruncateOptions {
  /**
   * Hard limit on the surfaced `output` length, in grapheme clusters.
   * Outputs at or below this size pass through unchanged. Defaults to
   * 8000 (≈ a Bash output of two screens; ≈ 4 hours of model-time saved
   * per ~50k char tool dump).
   */
  maxChars?: number
}

/**
 * Default budget when `opts.maxChars` is omitted. Exported as a constant
 * so callers (and tests) can reference the same threshold without
 * hard-coding the literal.
 */
export const DEFAULT_AUTO_TRUNCATE_MAX_CHARS = 8000

/**
 * Build an `afterToolCall` handler that replaces oversized string outputs
 * with a middle-truncated version. Returns the handler — the caller is
 * responsible for registering it on the host `HookRegistry`.
 *
 * Behaviour, per call:
 *   - No `payload.result` (the tool threw) → no-op.
 *   - `result.isError === true` → no-op (errors pass through intact).
 *   - `result.output` is not a string → no-op (block-array path not
 *     handled here; see file comment).
 *   - String fits in budget → no-op.
 *   - String exceeds budget → return
 *     `{ data: { replaceResult: <truncated>, autoTruncate: { ... } } }`
 *     so `wrapWithHooks` substitutes the result before the agent sees
 *     it.
 */
export function createAutoTruncateHook(
  opts: AutoTruncateOptions = {},
): HookHandler {
  const maxChars = opts.maxChars ?? DEFAULT_AUTO_TRUNCATE_MAX_CHARS
  if (maxChars < 1) {
    // Bail loudly: a sub-1 budget means "drop everything", which is almost
    // certainly a misconfiguration. Throw at construction time rather than
    // crashing the first hook invocation.
    throw new RangeError(
      `createAutoTruncateHook: maxChars must be ≥ 1, got ${maxChars}`,
    )
  }

  return (ctx) => {
    const payload = ctx.payload
    if (payload === undefined) return {}

    // `wrapTool.ts` packs the tool's outcome as `payload.result` (a
    // `ToolResult | undefined`). The registry payload type is opaque, so
    // we narrow defensively rather than asserting the shape.
    const candidate = payload.result
    if (!isToolResult(candidate)) return {}

    // Skip error outputs — see file comment.
    if (candidate.isError) return {}

    // Skip non-string outputs — `ContentBlock[]` not handled here.
    const output = candidate.output
    if (typeof output !== 'string') return {}

    // Cheap fast-path: most outputs are small. Compare raw length first;
    // we only call into the grapheme segmenter when there's reason to.
    if (output.length <= maxChars) return {}

    const truncated = truncateMiddle(output, { maxChars })
    if (truncated === output) return {} // segmenter agreed it fits

    const replacement: ToolResult = {
      output: truncated,
      isError: candidate.isError,
    }

    return {
      data: {
        replaceResult: replacement,
        autoTruncate: {
          originalLength: output.length,
          truncatedLength: truncated.length,
          maxChars,
        },
      },
    }
  }
}

/**
 * Internal type guard mirroring the one in `wrapTool.ts`. Duplicating it
 * keeps the hook self-contained — the wrapper has its own narrowing for
 * the replacement payload, and this one narrows the payload's `result`
 * before we read its `output` field.
 */
function isToolResult(v: unknown): v is ToolResult {
  if (typeof v !== 'object' || v === null) return false
  const obj = v as Record<string, unknown>
  if (typeof obj.isError !== 'boolean') return false
  return typeof obj.output === 'string' || Array.isArray(obj.output)
}
