// src/core/runFork/runForkedAgent.ts
//
// Factory + adapter. See ./types.ts for the design rationale.
//
// `createRunForkedAgent(deps)` returns a callable that issues a
// single bounded model call without the full task-agent infra. It is
// the analogue of upstream `runForkedAgent` for cases where the
// caller does not need:
//
//   • prompt-cache sharing with a parent context,
//   • tool-use cycling,
//   • sidechain transcript recording,
//   • telemetry events,
//   • abort-tree linkage to a parent controller.
//
// Production wiring is responsible for supplying a `callModel`
// implementation (see `./anthropicCallModel.ts`); tests pass a fake.
//
// Defaults are conservative and tuned for "summary / classify /
// rank" subtasks:
//   • maxTokens: 1024
//   • temperature: 0
//   • systemPrompt: '' (caller decides — most one-shot fork callers
//     embed the system instructions directly in the prompt).

import type {
  AwaySummaryRunForkFn,
  CallModelInput,
  RunForkDeps,
  RunForkOptions,
  RunForkResult,
  RunForkedAgentFn,
} from './types'

/** Default output-token budget for one-shot fork calls. */
export const DEFAULT_RUN_FORK_MAX_TOKENS = 1024

/** Default sampling temperature for one-shot fork calls. */
export const DEFAULT_RUN_FORK_TEMPERATURE = 0

/** Default system prompt when neither the factory nor the call site supplies one. */
export const DEFAULT_RUN_FORK_SYSTEM_PROMPT = ''

/**
 * Build a `RunForkedAgentFn` bound to a specific `callModel`
 * implementation and a default model.
 *
 * @example
 * ```ts
 * const runFork = createRunForkedAgent({
 *   callModel: anthropicCallModel(provider),
 *   modelName: 'claude-haiku-4-5',
 *   defaults: { maxTokens: 512 },
 * })
 * const { text } = await runFork({ prompt: 'Classify: ...' })
 * ```
 *
 * Throws synchronously at factory time if `modelName` is empty —
 * fail-loud beats a silent fallthrough that issues HTTP requests
 * against an unintended model.
 */
export function createRunForkedAgent(deps: RunForkDeps): RunForkedAgentFn {
  if (!deps.modelName || deps.modelName.trim().length === 0) {
    throw new Error(
      'createRunForkedAgent: deps.modelName must be a non-empty string',
    )
  }

  const defaultMaxTokens = deps.defaults?.maxTokens ?? DEFAULT_RUN_FORK_MAX_TOKENS
  const defaultTemperature =
    deps.defaults?.temperature ?? DEFAULT_RUN_FORK_TEMPERATURE
  const defaultSystemPrompt =
    deps.defaults?.systemPrompt ?? DEFAULT_RUN_FORK_SYSTEM_PROMPT

  return async function runForkedAgent(
    opts: RunForkOptions,
  ): Promise<RunForkResult> {
    if (typeof opts.prompt !== 'string' || opts.prompt.length === 0) {
      throw new Error('runForkedAgent: opts.prompt must be a non-empty string')
    }

    const input: CallModelInput = {
      model: opts.model ?? deps.modelName,
      systemPrompt: opts.systemPrompt ?? defaultSystemPrompt,
      prompt: opts.prompt,
      maxTokens: opts.maxTokens ?? defaultMaxTokens,
      temperature: opts.temperature ?? defaultTemperature,
      // No signal supplied → use a fresh, never-aborted controller so the
      // production binding always receives an AbortSignal (matches the
      // LLMProvider.stream contract). Tests can still pass their own.
      signal: opts.signal ?? new AbortController().signal,
    }

    try {
      return await deps.callModel(input)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // Re-throw with context — no swallowing. Callers that want
      // "best-effort" semantics (e.g. awaySummary returns null on
      // fork failure) wrap this in try/catch at their seam.
      throw new Error(`runForkedAgent (model=${input.model}): ${message}`, {
        cause: err,
      })
    }
  }
}

/**
 * Adapt a `RunForkedAgentFn` to the `RunForkFn` shape declared in
 * `src/core/awaySummary/summary.ts`:
 *
 *   `(prompt: string, signal: AbortSignal) => Promise<RunForkResult>`
 *
 * This is the bridge that lets the awaySummary module consume the
 * factory output without depending on `runFork/types.ts`. The bound
 * adapter passes the prompt through unchanged and forwards the
 * abort signal so awaySummary's cancellation semantics still work.
 *
 * Per-call factory defaults (modelName, maxTokens, temperature,
 * systemPrompt) are used — awaySummary intentionally does *not*
 * choose a model itself.
 */
export function adaptToAwaySummaryRunFork(
  fork: RunForkedAgentFn,
): AwaySummaryRunForkFn {
  return (prompt, signal) => fork({ prompt, signal })
}
