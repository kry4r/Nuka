// src/core/awaySummary/runner.ts
//
// End-to-end wiring helper for awaySummary. Composes:
//
//   1. createAnthropicCallModel(provider) — production CallModelFn over an
//      LLMProvider instance (network I/O happens here).
//   2. createRunForkedAgent({ callModel, modelName, defaults }) — bounded
//      one-shot fork callable that issues a single bounded model call.
//   3. adaptToAwaySummaryRunFork(runFork) — bridges the RunForkOptions API
//      to the simpler `(prompt, signal) => Promise<RunForkResult>` shape
//      consumed by `generateAwaySummary`.
//   4. getSessionMemoryContent({ cwd }) — optional per-project memory
//      content inlined into the recap prompt.
//
// Consumers (idle watcher, slash command, agent-callable Tool) supply:
//   - `messages`: the transcript window to summarize (the recap module
//     trims to RECENT_MESSAGE_WINDOW = 30 newest).
//   - `signal`: an AbortSignal to bail mid-call if the user returns or
//     the session shuts down.
//
// IMPORTANT: this module is a thin composer. All policy decisions
// (which model? which provider? which transcript window?) are
// parameters. Tests pass mock CallModelFn / provider to avoid network
// I/O — see `test/core/awaySummary/runner.test.ts`.

import type { LLMProvider } from '../provider/types'
import type { Message } from '../message/types'
import { createAnthropicCallModel } from '../runFork/anthropicCallModel'
import {
  createRunForkedAgent,
  adaptToAwaySummaryRunFork,
} from '../runFork/runForkedAgent'
import type { CallModelFn, RunForkDefaults } from '../runFork/types'
import {
  generateAwaySummary,
  type AwaySummaryResult,
  type GetSessionMemoryFn,
  type RunForkFn,
} from './summary'
import { getSessionMemoryContent } from '../memdir/sessionMemory'

/**
 * Default small/fast model for away-summary recap generation.
 *
 * Haiku 4.5 is intentionally the floor: this is a single-shot
 * one-paragraph summary, not a reasoning task. Callers can override
 * via `AwaySummaryRunnerOpts.modelName`.
 */
export const DEFAULT_AWAY_SUMMARY_MODEL = 'claude-haiku-4-5-20251001'

/**
 * Default output cap. The recap itself is hard-capped at 400 chars
 * inside `generateAwaySummary`; the token budget here gives the model
 * room to generate that and a little overhead without runaway cost.
 */
export const DEFAULT_AWAY_SUMMARY_MAX_TOKENS = 1024

export type AwaySummaryRunnerOpts = {
  /** Bound LLMProvider used to issue the model call. */
  provider: LLMProvider
  /** Override the default model name (claude-haiku-4-5). */
  modelName?: string
  /** Override per-call factory defaults (maxTokens, temperature, systemPrompt). */
  defaults?: RunForkDefaults
  /**
   * Working directory used to locate per-project session memory. Defaults
   * to `process.cwd()` at runner-construction time. Passed through to
   * `getSessionMemoryContent({ cwd })`.
   */
  cwd?: string
  /**
   * Test/override hook — inject a fake `CallModelFn` to avoid touching
   * the provider. Production callers leave this unset and the runner
   * builds the production binding via `createAnthropicCallModel`.
   */
  callModel?: CallModelFn
  /**
   * Test/override hook — inject a fake session-memory accessor. When
   * unset, the runner uses `getSessionMemoryContent({ cwd })`. Pass
   * `null` to fully disable memory lookup (the recap will skip the
   * memory block).
   */
  getSessionMemory?: GetSessionMemoryFn | null
}

export type AwaySummaryRunInput = {
  /** Transcript window. The recap trims to the trailing 30 messages. */
  messages: readonly Message[]
  /** Abort signal — aborted before/during the fork → returns null. */
  signal: AbortSignal
}

/**
 * Callable produced by `createAwaySummaryRunner`. Returns null when
 * `generateAwaySummary` declines to produce a recap (empty transcript,
 * aborted signal, model error, empty model reply).
 */
export type AwaySummaryRunner = (
  input: AwaySummaryRunInput,
) => Promise<AwaySummaryResult | null>

/**
 * Compose a single callable that issues a "while you were away" recap
 * using Nuka's runFork adapter + the awaySummary module.
 *
 * @example
 * ```ts
 * const { provider } = providers.resolveFor(session)
 * const runRecap = createAwaySummaryRunner({ provider })
 * const result = await runRecap({ messages: session.messages, signal: ctrl.signal })
 * if (result) console.log(result.text)
 * ```
 *
 * Throws synchronously at factory time if `provider` is missing or
 * `modelName` is empty — fail-loud beats silent fallthrough.
 */
export function createAwaySummaryRunner(
  opts: AwaySummaryRunnerOpts,
): AwaySummaryRunner {
  if (!opts.provider) {
    throw new Error('createAwaySummaryRunner: opts.provider is required')
  }
  const modelName = opts.modelName ?? DEFAULT_AWAY_SUMMARY_MODEL
  const defaults: RunForkDefaults = opts.defaults ?? {
    maxTokens: DEFAULT_AWAY_SUMMARY_MAX_TOKENS,
  }

  // Either consume the injected `callModel` (tests / overrides) or build
  // the production binding over the provider stream.
  const callModel = opts.callModel ?? createAnthropicCallModel(opts.provider)
  const runForkInternal = createRunForkedAgent({ callModel, modelName, defaults })
  const runFork: RunForkFn = adaptToAwaySummaryRunFork(runForkInternal)

  // Memory accessor: explicit `null` disables it; explicit fn overrides;
  // otherwise the runner reads MEMORY.md from the per-project memdir.
  let getSessionMemory: GetSessionMemoryFn | undefined
  if (opts.getSessionMemory === null) {
    getSessionMemory = undefined
  } else if (opts.getSessionMemory) {
    getSessionMemory = opts.getSessionMemory
  } else {
    const cwd = opts.cwd ?? process.cwd()
    getSessionMemory = () => getSessionMemoryContent({ cwd })
  }

  return async function runAwaySummary({
    messages,
    signal,
  }: AwaySummaryRunInput): Promise<AwaySummaryResult | null> {
    return generateAwaySummary({
      messages,
      signal,
      deps: {
        runFork,
        ...(getSessionMemory !== undefined ? { getSessionMemoryContent: getSessionMemory } : {}),
      },
    })
  }
}
