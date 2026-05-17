// src/core/truncate/index.ts
//
// Public surface of the truncation utilities. Pure logic, no UI deps.

export {
  truncateMiddle,
  truncateLines,
  truncateToCharBudget,
  smartTruncate,
  type TruncateMiddleOptions,
  type TruncateLinesOptions,
  type SmartTruncateOptions,
} from './truncate'

export {
  TRUNCATE_TOOL_NAME,
  TruncateTool,
  runTruncate,
  type TruncateAction,
  type TruncateInput,
  type TruncateResult,
} from './truncateTool'
