// src/core/urlExtract/urlExtractHook.ts
//
// `afterToolCall` hook that scans a tool's STRING `output` for URLs (via
// the pure `extractUrls` extractor in this directory) and ANNOTATES the
// surfaced ToolResult with a sibling `urls: string[]` field — without
// touching `output` itself.
//
// Why annotate and not transform:
//
//   Other afterToolCall hooks in this codebase mutate the text shape:
//   `pathDisplayHook` rewrites absolute paths, `wordWrapHook` re-flows
//   long lines, `jsonFormatHook` pretty-prints JSON, `autoTruncateHook`
//   middle-cuts oversize output. Adding URL recognition to the *text*
//   would either step on those passes (inserting markers that wordWrap
//   would then chop) or fight with them for canonical shape.
//
//   Instead, this hook leaves `output` byte-for-byte unchanged and tacks
//   a structured `urls` field onto the replacement result. Downstream
//   observers (TUI Cmd+Click sidebar, telemetry, fetcher heuristics, the
//   model itself via tool-result serialisation) can read it; consumers
//   that don't know the field just ignore it. The `data.urlExtract`
//   block carries metadata (counts, truncation) the same way
//   `autoTruncateHook` carries `data.autoTruncate`.
//
// Replacement uses the `data.replaceResult` contract honoured by
// `wrapWithHooks` (see `core/hooks/wrapTool.ts` step 4a). The wrapper's
// `isToolResult` guard accepts any object with `{ output: string|array;
// isError: boolean }` — extra sibling fields pass through structurally,
// so `{ ...result, urls: [...] }` reaches the caller intact even though
// the `ToolResult` type doesn't declare `urls`. Composability matters
// here: this hook can run in pipeline mode alongside the text-mutating
// ones; whichever sees the result last carries forward the `urls`
// field, because each text-mutating hook spreads `...candidate` when it
// rebuilds the replacement.
//
// The hook is conservative on purpose:
//
//   * Skip when `payload.result` is missing (tool threw) — nothing to
//     annotate.
//   * Skip `ContentBlock[]` output — scanning concatenated block text
//     would lie about offsets. A separate iter can teach the extractor
//     to walk block arrays if needed.
//   * Skip errors by default — most error stack traces don't contain
//     URLs we care about, and on the rare ones that do (a 404 page,
//     CDN-served traceback), the cost of false positives is higher than
//     missing the URL. Opt-in via `includeErrors`.
//   * Skip outputs below `minLength` — too short to be worth scanning;
//     also, isolated tokens like "v1.2.3" can fool the bare-domain mode
//     of the extractor, so we wait until there's real prose context.
//   * Cap recorded URLs at `maxUrls` — a tool output that contains 10k
//     URLs is almost certainly a server-side dump where shipping every
//     hit just bloats the result. Telemetry records both the cap and
//     the original count so consumers can detect the truncation.
//   * Dedupe URLs (case-sensitive on the canonical extraction). Keeps
//     the list compact when output mentions the same URL repeatedly.
//   * Skip when the scan finds zero URLs — return `{}` so the wrapper
//     doesn't churn through a no-op replacement.

import type { HookHandler } from '../hooks/events'
import type { ToolResult } from '../tools/types'
import { extractUrls } from './urlExtract'

/**
 * Behavioural options for {@link createUrlExtractHandler}.
 */
export interface UrlExtractHookConfig {
  /**
   * Restrict the hook to a specific set of tool names. If omitted (or
   * empty), every afterToolCall event is considered. Matching is exact
   * (case-sensitive), mirroring how `toolName` is emitted by
   * `wrapWithHooks`.
   */
  toolNames?: string[]
  /**
   * Hard cap on the number of URLs recorded in the annotation. URLs
   * beyond this count are dropped (but the original total is preserved
   * in `data.urlExtract.totalFound`). Defaults to 50 — high enough to
   * capture typical CLI / curl output, low enough to keep the
   * annotation cheap to serialise and inspect. Must be at least 1.
   */
  maxUrls?: number
  /**
   * Minimum byte-length of `output` before the hook attempts a scan.
   * Outputs shorter than this pass through unchanged. Defaults to 50 —
   * below that there's rarely enough prose context to disambiguate a
   * URL-looking token from version triples (`v1.2.3`) or filenames
   * (`README.md`).
   */
  minLength?: number
  /**
   * Whether to scan tool outputs whose `isError` flag is `true`.
   * Defaults to `false`. Error outputs rarely carry useful URLs and
   * scanning them risks surfacing stack-trace fragments that look like
   * domains.
   */
  includeErrors?: boolean
}

/** Default URL cap when `config.maxUrls` is omitted. */
export const DEFAULT_URL_EXTRACT_HOOK_MAX_URLS = 50
/** Default minimum output length before the hook attempts a scan. */
export const DEFAULT_URL_EXTRACT_HOOK_MIN_LENGTH = 50

/**
 * Build an `afterToolCall` handler that scans STRING tool output for
 * URLs and adds them as a `urls: string[]` sibling on the replacement
 * result. Returns a {@link HookHandler}; the caller registers it on
 * the host `HookRegistry`.
 *
 * Behaviour, per call:
 *   - `config.toolNames` set and `ctx.toolName` not in the list → no-op.
 *   - `payload` missing or `payload.result` not a `ToolResult` → no-op.
 *   - `result.isError === true` AND `includeErrors` falsy → no-op.
 *   - `result.output` is not a string → no-op (ContentBlock[] passthrough).
 *   - `output.length < minLength` → no-op.
 *   - `extractUrls(output)` yields zero URLs → no-op.
 *   - Otherwise → return
 *     `{ data: { replaceResult: { ...result, urls: [...] }, urlExtract: { ... } } }`
 *     so `wrapWithHooks` substitutes the result. `output` is preserved
 *     byte-for-byte; only the sibling `urls` field is added.
 *
 * `isError` is preserved exactly. The hook never escalates a passing
 * tool to an error or downgrades an error to a success.
 */
export function createUrlExtractHandler(
  config: UrlExtractHookConfig = {},
): HookHandler {
  const maxUrls = config.maxUrls ?? DEFAULT_URL_EXTRACT_HOOK_MAX_URLS
  const minLength = config.minLength ?? DEFAULT_URL_EXTRACT_HOOK_MIN_LENGTH
  const includeErrors = config.includeErrors ?? false

  if (!Number.isInteger(maxUrls) || maxUrls < 1) {
    // Bail loudly: maxUrls < 1 means "record nothing", which would make
    // the hook a no-op while still doing the scan — almost certainly a
    // misconfiguration. Throw at construction rather than crash later.
    throw new RangeError(
      `createUrlExtractHandler: maxUrls must be a positive integer, got ${maxUrls}`,
    )
  }
  if (!Number.isInteger(minLength) || minLength < 0) {
    throw new RangeError(
      `createUrlExtractHandler: minLength must be a non-negative integer, got ${minLength}`,
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

    // Error gate — see file comment.
    if (candidate.isError && !includeErrors) return {}

    // Skip non-string outputs — ContentBlock[] handled by future iter.
    const output = candidate.output
    if (typeof output !== 'string') return {}

    // Length gate: avoid noisy scans of tiny outputs.
    if (output.length < minLength) return {}

    // Extract, dedupe (preserve first-seen order), and cap.
    const matches = extractUrls(output)
    if (matches.length === 0) return {}

    const seen = new Set<string>()
    const urls: string[] = []
    for (const m of matches) {
      if (seen.has(m.url)) continue
      seen.add(m.url)
      urls.push(m.url)
      if (urls.length >= maxUrls) break
    }
    // After dedupe, the deduped list might be empty if all matches were
    // duplicates of each other — but extractUrls returning >0 means at
    // least one unique URL by definition. Belt-and-braces guard anyway,
    // since a future extractor change could break this invariant.
    if (urls.length === 0) return {}

    // Build the replacement. `output` is preserved verbatim; we tack on
    // a sibling `urls` field. The replacement object isn't typed as
    // `ToolResult` because `urls` isn't part of that type — instead we
    // construct an opaque record and let `wrapWithHooks`'s structural
    // `isToolResult` guard accept it (the guard only checks for `output`
    // and `isError`). The runtime ToolResult that flows downstream
    // carries the extra field intact even though the type doesn't
    // declare it.
    const replacement: Record<string, unknown> = {
      ...candidate,
      urls,
    }

    return {
      data: {
        replaceResult: replacement,
        urlExtract: {
          totalFound: matches.length,
          recorded: urls.length,
          maxUrls,
          truncated: matches.length > urls.length,
        },
      },
    }
  }
}

/**
 * Internal type guard mirroring the one in `wrapTool.ts` /
 * `autoTruncateHook.ts` / `pathDisplayHook.ts` / `jsonFormatHook.ts` /
 * `wordWrapHook.ts`. Duplicating it keeps the hook self-contained — the
 * wrapper has its own narrowing for the replacement payload, and this
 * one narrows the payload's `result` before we read its `output` field.
 */
function isToolResult(v: unknown): v is ToolResult {
  if (typeof v !== 'object' || v === null) return false
  const obj = v as Record<string, unknown>
  if (typeof obj.isError !== 'boolean') return false
  return typeof obj.output === 'string' || Array.isArray(obj.output)
}
