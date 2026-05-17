// src/core/whitespace/whitespaceHook.ts
//
// `afterAssistantMessage` hook that runs `whitespace.normalize` over the
// assembled assistant text. The handler now BOTH observes (diagnostic
// payload under `data.whitespaceNormalize`) AND rewrites (via
// `data.replaceText`) — the `afterAssistantMessage` event grew a
// mutable contract in this iter, so the normalized form is written
// back to the assistant message before persistence when normalization
// actually changes the text.
//
// Two return-shape rules:
//
//   1. `data.whitespaceNormalize` — kept verbatim for backward
//      compatibility with observers (tests, telemetry, plugin
//      consumers) that subscribed when the event was observer-only.
//   2. `data.replaceText` — set to `normalized` ONLY when
//      `changed === true`. Setting it on a no-op normalize would
//      trip the fire site's "string ⇒ rewrite" type guard for no
//      reason (the rewrite would be a self-assign but would still
//      reshape `assistant.content` into a single text block,
//      potentially losing the original block layout). Skipping the
//      key when unchanged is the safer default.
//
// Opt-in via `NUKA_WHITESPACE_HOOK=1` (default off) so the handler is
// inert in workflows that have not requested it — matches the iter
// conventions for BBBB / LLL / EEEE / NNN.
//
// Behaviour, per call:
//
//   * Skip (return `{}`) when `ctx.event !== 'afterAssistantMessage'`
//     (defence in depth: a registry mis-route shouldn't make us touch
//     the payload).
//   * Skip when the payload is missing or `text` is not a string.
//   * Skip when the input is below `minLength`.
//   * Otherwise return `{ data: { whitespaceNormalize: { original,
//     normalized, changed }, [replaceText?: normalized] } }`.
//
// The handler never throws — `normalize` is pure on strings and the
// type guards above already gate it. Defensive `try/catch` would only
// mask a future regression in `normalize` itself.

import type { HookHandler } from '../hooks/events'
import { normalize, type NormalizeOptions } from './whitespace'

/**
 * Behavioural options for {@link createWhitespaceHookHandler}.
 */
export interface WhitespaceHookConfig {
  /**
   * Options forwarded to {@link normalize}. When omitted, `normalize`'s
   * defaults apply (dedent + trimTrailing + collapseBlanks + trimEdges
   * + LF line endings). Callers wanting a stricter pass can opt in to
   * `expandTabs` etc.
   */
  normalize?: NormalizeOptions
  /**
   * Minimum input length below which the handler returns `{}` without
   * computing the normalized form. Defaults to `0` (always compute).
   * Setting a small positive value (e.g. `200`) keeps the handler quiet
   * for short answers.
   */
  minLength?: number
}

/**
 * Diagnostic payload surfaced on `HookResult.data.whitespaceNormalize`.
 * Observers read this to decide whether to act on the normalization.
 */
export interface WhitespaceNormalizeDiagnostic {
  /** The model's original assembled text (text blocks only, joined). */
  original: string
  /** Result of `normalize(original, options)`. */
  normalized: string
  /** `original !== normalized`. */
  changed: boolean
}

/**
 * Build an `afterAssistantMessage` handler that computes a normalized
 * form of the assistant's text via {@link normalize}. Returns a
 * {@link HookHandler}; the caller registers it on the host
 * `HookRegistry`.
 *
 * The handler is OBSERVER-ONLY at the protocol level — see the file
 * header for the rationale.
 */
export function createWhitespaceHookHandler(
  config: WhitespaceHookConfig = {},
): HookHandler {
  const minLength = config.minLength ?? 0
  if (!Number.isInteger(minLength) || minLength < 0) {
    throw new RangeError(
      `createWhitespaceHookHandler: minLength must be a non-negative integer, got ${minLength}`,
    )
  }
  const opts = config.normalize

  return (ctx) => {
    if (ctx.event !== 'afterAssistantMessage') return {}
    const payload = ctx.payload
    if (payload === undefined) return {}
    const text = (payload as { text?: unknown }).text
    if (typeof text !== 'string') return {}
    if (text.length < minLength) return {}

    const normalized = opts ? normalize(text, opts) : normalize(text)
    const changed = normalized !== text
    const diagnostic: WhitespaceNormalizeDiagnostic = {
      original: text,
      normalized,
      changed,
    }
    // Build data payload incrementally: the diagnostic always rides
    // along (back-compat with the observer-only era); `replaceText`
    // is only attached on a real change (see file header for rationale).
    const data: Record<string, unknown> = { whitespaceNormalize: diagnostic }
    if (changed) data['replaceText'] = normalized
    return { data }
  }
}
