// src/core/wordWrap/wordWrapHook.ts
//
// `afterToolCall` hook that re-flows a tool's STRING `output` to fit a
// terminal-column budget via the pure `wrapText` helper in this directory.
//
// Why a hook, and why opt-in:
//
//   Many tool outputs come back as a single ~1000-char line — Bash stdout
//   that happened to not wrap, a Grep summary, a curl body fetched from a
//   server that never inserted line breaks. Such lines flatten the agent
//   transcript and steal width budget from neighbouring TUI columns. A
//   single afterToolCall hook gives uniform coverage for free, gated by
//   one env var so workflows that need verbatim columnar output (CI logs,
//   mechanical diff comparison) keep the default behaviour.
//
//   The hook is conservative on purpose:
//
//   * Skip when the surfaced shape is `ContentBlock[]` rather than a
//     bare string. Block arrays already encode structure (image bytes,
//     structured payloads); a wrap pass over the joined text would either
//     mangle a block or drop one.
//   * Skip error results (`isError: true`). Stack traces / final error
//     messages are where debugging value lives — re-flowing them across
//     paragraph boundaries makes them harder to scan and confuses log
//     scrapers. Mirrors `autoTruncateHook.ts` + `pathDisplayHook.ts`.
//   * Skip outputs shorter than `minLength`. Short ToolResults are
//     already readable; a wrap pass on a 40-char string adds churn
//     without benefit.
//   * Skip outputs that ALREADY look wrapped: every line at or below
//     `width` means no source line exceeds the budget, so wrapping
//     produces an identical output and we'd just pay the cost. Opt-out
//     available via `skipIfAlreadyWrapped: false` for callers that want
//     forced re-flow (e.g. to apply a tighter budget).
//
//   The wrap pass uses `wrapText` from `./wordWrap`. That helper splits
//   on `\n` and wraps each paragraph independently (its `preserveNewlines`
//   default is true), so multi-paragraph tool output keeps its blank-line
//   separators while every long paragraph gets re-flowed to the budget.
//   ANSI escapes (zero-width) and CJK glyphs (2 cells) are counted in
//   terminal cells, so the budget is honest.
//
// Replacement uses the `data.replaceResult` contract honoured by
// `wrapWithHooks` (see `core/hooks/wrapTool.ts` step 4a): a successful
// post-hook may return `{ data: { replaceResult: <ToolResult> } }` and
// the wrapper substitutes the surfaced output before the agent sees it.

import type { HookHandler } from '../hooks/events'
import type { ToolResult } from '../tools/types'
import { stringWidth } from '../stringWidth'
import { wrapText } from './wordWrap'

/**
 * Behavioural options for {@link createWordWrapHandler}.
 */
export interface WordWrapHookConfig {
  /**
   * Target column budget passed to `wrapText`. Default 100 — wide enough
   * to fit a typical commit message or shell line on a modern terminal,
   * narrow enough to keep transcripts readable when the surrounding TUI
   * gives up some columns. Must be a positive integer.
   */
  width?: number
  /**
   * Restrict the hook to a specific set of tool names. If omitted (or
   * empty), every afterToolCall event is considered. Matching is exact
   * (case-sensitive), mirroring how `toolName` is emitted by
   * `wrapWithHooks`.
   */
  toolNames?: string[]
  /**
   * Minimum byte-length of `output` before the hook attempts to wrap.
   * Outputs shorter than this pass through unchanged. Default 200 — at
   * `width: 100` that's roughly two lines worth, so we only re-flow when
   * there's enough text to be worth a wrap pass.
   */
  minLength?: number
  /**
   * When `true` (default), skip the wrap if every existing line already
   * fits inside `width` (i.e. `max(line cell width) ≤ width`). This
   * prevents double-wrapping when the hook chains with another that
   * already flowed the text. Set to `false` to force a re-wrap (useful
   * when you want to tighten a previously wider budget).
   */
  skipIfAlreadyWrapped?: boolean
}

/** Default column budget when `config.width` is omitted. */
export const DEFAULT_WORD_WRAP_HOOK_WIDTH = 100
/** Default minimum output length before the hook attempts to wrap. */
export const DEFAULT_WORD_WRAP_HOOK_MIN_LENGTH = 200

/**
 * Build an `afterToolCall` handler that re-flows STRING tool output to
 * fit a column budget. Returns a {@link HookHandler}; the caller registers
 * it on the host `HookRegistry`.
 *
 * Behaviour, per call:
 *   - `config.toolNames` set and `ctx.toolName` not in the list → no-op.
 *   - `payload` missing or `payload.result` not a `ToolResult` → no-op.
 *   - `result.isError === true` → no-op (error text preserved verbatim).
 *   - `result.output` is not a string → no-op (ContentBlock[] passthrough).
 *   - `output.length < minLength` → no-op.
 *   - `skipIfAlreadyWrapped` true AND every line's display width is
 *     `≤ width` → no-op (avoid churn, avoid double-wrap).
 *   - `wrapText(output, { width })` produces the same string → no-op.
 *   - Otherwise → return
 *     `{ data: { replaceResult: { ...result, output: wrapped }, wordWrap: { ... } } }`
 *     so `wrapWithHooks` substitutes the surfaced output before the agent
 *     sees it.
 *
 * `isError` is preserved exactly. The hook never escalates a passing
 * tool to an error or downgrades an error to a success.
 */
export function createWordWrapHandler(
  config: WordWrapHookConfig = {},
): HookHandler {
  const width = config.width ?? DEFAULT_WORD_WRAP_HOOK_WIDTH
  const minLength = config.minLength ?? DEFAULT_WORD_WRAP_HOOK_MIN_LENGTH
  const skipIfAlreadyWrapped = config.skipIfAlreadyWrapped ?? true

  if (!Number.isInteger(width) || width < 1) {
    // Bail loudly: width < 1 means "wrap to 0 cells", which would produce
    // either garbage or a single-cell column of text — almost certainly
    // a misconfiguration. Throw at construction time rather than crashing
    // on the first hook invocation.
    throw new RangeError(
      `createWordWrapHandler: width must be a positive integer, got ${width}`,
    )
  }
  if (!Number.isInteger(minLength) || minLength < 0) {
    throw new RangeError(
      `createWordWrapHandler: minLength must be a non-negative integer, got ${minLength}`,
    )
  }

  // Pre-compute the allow-set for O(1) name match. Empty/missing → all tools.
  const allowSet =
    config.toolNames && config.toolNames.length > 0
      ? new Set(config.toolNames)
      : undefined

  return (ctx) => {
    if (allowSet) {
      const toolName = ctx.toolName
      if (toolName === undefined) return {}
      if (!allowSet.has(toolName)) return {}
    }

    const payload = ctx.payload
    if (payload === undefined) return {}

    const candidate = payload.result
    if (!isToolResult(candidate)) return {}

    // Skip error outputs — see file comment.
    if (candidate.isError) return {}

    const output = candidate.output
    if (typeof output !== 'string') return {}

    // Length gate: avoid noisy reformatting of short outputs.
    if (output.length < minLength) return {}

    // Already-wrapped detection: cheaper than a full wrap pass, so we do
    // it first. We split on `\n` (no allocation cost beyond the array)
    // and measure each line in terminal cells (so ANSI/CJK get counted
    // honestly). The wrap pass would emit the same lines if no line
    // exceeded the budget, so we can short-circuit.
    if (skipIfAlreadyWrapped) {
      let maxLineWidth = 0
      // Iterate without splitting — saves an allocation on large outputs.
      let lineStart = 0
      for (let i = 0; i <= output.length; i++) {
        const ch = i < output.length ? output.charCodeAt(i) : -1
        if (ch === 0x0a /* \n */ || i === output.length) {
          const line = output.slice(lineStart, i)
          const w = stringWidth(line)
          if (w > maxLineWidth) maxLineWidth = w
          // Early exit: as soon as any line overflows the budget, the
          // wrap pass will do work — stop measuring.
          if (maxLineWidth > width) break
          lineStart = i + 1
        }
      }
      if (maxLineWidth <= width) return {}
    }

    const wrapped = wrapText(output, { width })
    // If wrapping produced no observable change (e.g. inputs at exactly
    // the budget that happen to be word-aligned), skip — avoids surfacing
    // a no-op replaceResult to downstream observers.
    if (wrapped === output) return {}

    const replacement: ToolResult = {
      ...candidate,
      output: wrapped,
    }

    return {
      data: {
        replaceResult: replacement,
        wordWrap: {
          originalLength: output.length,
          wrappedLength: wrapped.length,
          width,
        },
      },
    }
  }
}

/**
 * Internal type guard mirroring the one in `wrapTool.ts` /
 * `autoTruncateHook.ts` / `pathDisplayHook.ts` / `jsonFormatHook.ts`.
 * Duplicating it keeps the hook self-contained — the wrapper has its own
 * narrowing for the replacement payload, and this one narrows the
 * payload's `result` before we read its `output` field.
 */
function isToolResult(v: unknown): v is ToolResult {
  if (typeof v !== 'object' || v === null) return false
  const obj = v as Record<string, unknown>
  if (typeof obj.isError !== 'boolean') return false
  return typeof obj.output === 'string' || Array.isArray(obj.output)
}
