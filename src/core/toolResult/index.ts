// src/core/toolResult/index.ts
//
// Public surface of the toolResult core area — helpers that observe or
// transform a Tool's `ToolResult` after it executes. Today this is the
// auto-truncation hook; future iters can add result-summarisation,
// schema validation, redaction, etc., keeping the same `afterToolCall`
// integration shape.

export {
  createAutoTruncateHook,
  DEFAULT_AUTO_TRUNCATE_MAX_CHARS,
  type AutoTruncateOptions,
} from './autoTruncateHook'
