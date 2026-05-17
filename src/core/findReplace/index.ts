// src/core/findReplace/index.ts
//
// Public surface of the FindReplace compound tool. Re-exports the Tool
// and the pure-library `runFindReplace` entry point so internal callers
// (e.g. a future slash command) can reuse the orchestration without
// going through the agent surface.

export {
  FIND_REPLACE_DEFAULT_MAX_FILES,
  FIND_REPLACE_HARD_MAX_FILES,
  FIND_REPLACE_TOOL_NAME,
  FindReplaceTool,
  runFindReplace,
} from './findReplaceTool'
export type {
  FindReplaceApplyResult,
  FindReplaceInput,
  FindReplacePreview,
  FindReplaceResult,
} from './findReplaceTool'
