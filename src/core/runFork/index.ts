// src/core/runFork/index.ts
//
// Barrel for the runForkedAgent small/fast-model adapter.
//
// Public surface:
//   • createRunForkedAgent — factory that produces a `RunForkedAgentFn`
//     bound to an injected `callModel` and a default model name.
//   • adaptToAwaySummaryRunFork — bridges the factory output to the
//     `RunForkFn` signature consumed by `src/core/awaySummary/summary.ts`.
//   • createAnthropicCallModel — production `CallModelFn` backed by
//     an `LLMProvider`.
//   • Type re-exports for callers.

export {
  createRunForkedAgent,
  adaptToAwaySummaryRunFork,
  DEFAULT_RUN_FORK_MAX_TOKENS,
  DEFAULT_RUN_FORK_TEMPERATURE,
  DEFAULT_RUN_FORK_SYSTEM_PROMPT,
} from './runForkedAgent'

export { createAnthropicCallModel } from './anthropicCallModel'

export type {
  AwaySummaryRunForkFn,
  CallModelFn,
  CallModelInput,
  RunForkDefaults,
  RunForkDeps,
  RunForkOptions,
  RunForkResult,
  RunForkedAgentFn,
} from './types'
