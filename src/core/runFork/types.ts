// src/core/runFork/types.ts
//
// Types for the "runForkedAgent" small/fast-model adapter.
//
// This module is a *thin* port of upstream Nuka-Code's
// `src/utils/forkedAgent.ts::runForkedAgent`. The upstream version is
// heavily coupled to its full agent infrastructure (query loop,
// telemetry events, sidechain transcript I/O, prompt-cache plumbing,
// abort tree, permission hooks). Nuka does not have that infra wired
// here, and `src/core/awaySummary/summary.ts` only needs the simple
// direct-call path: one prompt in, one text response out.
//
// The adapter therefore exposes a *factory* (`createRunForkedAgent`)
// that takes a `callModel` dependency. The factory returns a
// `RunForkFn`-shaped callable that
//
//   • assembles a single-turn user message,
//   • invokes the injected `callModel` once,
//   • returns `{ text, usage?, modelUsed? }`.
//
// Tests construct the factory with a fake `callModel` so no network
// I/O is required. The production binding (see
// `./anthropicCallModel.ts`) wraps Nuka's existing `LLMProvider`
// abstraction so the adapter uses whatever auth / SDK the rest of
// Nuka already uses.

import type { TokenUsage } from '../message/types'

/**
 * Output shape returned by both the high-level adapter and the
 * injected `callModel` dep. Matches the `RunForkResult` declared in
 * `src/core/awaySummary/summary.ts` so the adapter is drop-in
 * compatible with `RunForkFn`.
 */
export type RunForkResult = {
  text: string
  usage?: TokenUsage
  modelUsed?: string
}

/**
 * Per-call options accepted by the runForkedAgent helper. All fields
 * are optional — sensible defaults are supplied by the factory's
 * `defaults` (see `RunForkDefaults`).
 */
export type RunForkOptions = {
  /** The user-side prompt. Required. */
  prompt: string
  /** Optional system prompt. Overrides the factory default. */
  systemPrompt?: string
  /** Output cap. Overrides the factory default. */
  maxTokens?: number
  /** Sampling temperature. Overrides the factory default (0). */
  temperature?: number
  /** Model name. Overrides the factory's `modelName`. */
  model?: string
  /**
   * Optional abort signal. If provided, the adapter forwards it to
   * `callModel` so long-running calls can be cancelled by the caller.
   */
  signal?: AbortSignal
}

/**
 * Default values applied when a `RunForkOptions` field is omitted.
 *
 * `modelName` is *not* part of `RunForkDefaults` because it is
 * already on `RunForkDeps` (where it logically belongs — the model
 * is bound at factory time, not at default-time). Per-call overrides
 * via `RunForkOptions.model` still take precedence.
 */
export type RunForkDefaults = {
  /** Default cap on output tokens. */
  maxTokens?: number
  /** Default sampling temperature. */
  temperature?: number
  /** Default system prompt. */
  systemPrompt?: string
}

/**
 * Low-level model call. The factory's job is to assemble
 * `CallModelInput` from `RunForkOptions` + defaults; the impl's job
 * is to issue the actual request and return the model's text.
 *
 * Production binding: `anthropicCallModel.ts` — wraps an
 * `LLMProvider` stream and accumulates `text_delta` events.
 *
 * Test binding: a `vi.fn()` returning a canned `RunForkResult`.
 */
export type CallModelInput = {
  model: string
  systemPrompt: string
  prompt: string
  maxTokens: number
  temperature: number
  signal: AbortSignal
}

export type CallModelFn = (input: CallModelInput) => Promise<RunForkResult>

/**
 * Factory dependencies. `callModel` is required (no global default
 * is provided — keeping the module pure-library means callers wire
 * it from the existing provider resolver). `modelName` is also
 * required so a forgotten model setting fails loudly at factory
 * construction instead of silently routing to an unintended default.
 */
export type RunForkDeps = {
  /** Low-level callable, injected for testability. */
  callModel: CallModelFn
  /** Bound model name. Per-call `RunForkOptions.model` overrides this. */
  modelName: string
  /** Per-call defaults. Per-call options override these. */
  defaults?: RunForkDefaults
}

/**
 * High-level callable returned by `createRunForkedAgent`. Accepts a
 * full `RunForkOptions` and returns a `RunForkResult`.
 *
 * NOTE: this is **not** the `RunForkFn` exported from
 * `src/core/awaySummary/summary.ts`. That signature is
 * `(prompt: string, signal: AbortSignal) => Promise<RunForkResult>`
 * — a strictly simpler shape. The two are bridged by
 * `adaptToAwaySummaryRunFork()` in `./runForkedAgent.ts`.
 */
export type RunForkedAgentFn = (opts: RunForkOptions) => Promise<RunForkResult>

/**
 * Compatibility shape mirroring
 * `src/core/awaySummary/summary.ts::RunForkFn`. Reproduced here so
 * `src/core/runFork/` does not need to import from `awaySummary/`
 * (avoids a backwards dependency from a generic utility onto a
 * specific feature module).
 */
export type AwaySummaryRunForkFn = (
  prompt: string,
  signal: AbortSignal,
) => Promise<RunForkResult>
