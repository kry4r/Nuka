// src/core/awaySummary/index.ts
//
// Barrel for the awaySummary feature.
//
// Public surface:
//   • generateAwaySummary — core recap function (DI-shaped).
//   • RunForkFn / GetSessionMemoryFn / AwaySummaryDeps / Input / Result
//     — types the caller composes.
//   • RECENT_MESSAGE_WINDOW / AWAY_SUMMARY_MAX_CHARS — public constants.
//   • createAwaySummaryRunner — production composer that wires
//     provider → runFork → adapter → memory accessor → generateAwaySummary.
//   • makeAwaySummaryTool — agent-callable Tool surface bound to a runner.
//   • AwaySummary tool name + input type for callers that need to refer
//     to the registration symbol or build a synthetic ToolCall.

export {
  generateAwaySummary,
  RECENT_MESSAGE_WINDOW,
  AWAY_SUMMARY_MAX_CHARS,
} from './summary'

export type {
  AwaySummaryDeps,
  AwaySummaryInput,
  AwaySummaryResult,
  GetSessionMemoryFn,
  RunForkFn,
  RunForkResult,
} from './summary'

export {
  createAwaySummaryRunner,
  DEFAULT_AWAY_SUMMARY_MODEL,
  DEFAULT_AWAY_SUMMARY_MAX_TOKENS,
} from './runner'

export type {
  AwaySummaryRunner,
  AwaySummaryRunnerOpts,
  AwaySummaryRunInput,
} from './runner'

export {
  makeAwaySummaryTool,
  AWAY_SUMMARY_TOOL_NAME,
} from './awaySummaryTool'

export type {
  AwaySummaryToolInput,
  AwaySummaryToolMessage,
} from './awaySummaryTool'

export {
  startIdleAwaySummaryHook,
  DEFAULT_IDLE_THRESHOLD_MS,
} from './idleHook'

export type {
  IdleAwaySummaryHook,
  IdleAwaySummaryHookOpts,
  GetMessagesFn,
  RecapSinkFn,
  AwayRecapEvent,
  RecapResultListener,
} from './idleHook'
