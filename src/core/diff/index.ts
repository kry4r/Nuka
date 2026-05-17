// src/core/diff/index.ts
//
// Public surface of the diff utilities. Re-exports the pure formatter,
// parser, applier, and line-diff helpers. No side-effects; no React/ink
// dependencies; the `diff` npm package is the only runtime dep.

export {
  formatUnifiedDiff,
  formatTwoFilesUnifiedDiff,
  getHunksFromContents,
  adjustHunkLineNumbers,
  countLinesChanged,
  DEFAULT_CONTEXT_LINES,
  DEFAULT_DIFF_TIMEOUT_MS,
  type FormatUnifiedDiffOptions,
  type GetHunksOptions,
  type StructuredPatchHunk,
} from './format'

export {
  parseUnifiedDiff,
  parseUnifiedDiffSingleFile,
  type ParsedDiff,
  type ParsedDiffFile,
} from './parse'

export {
  applyUnifiedDiff,
  type ApplyUnifiedDiffOptions,
  type ApplyUnifiedDiffResult,
} from './apply'

export {
  diffLinesSimple,
  summariseLineChanges,
  type DiffLinesOptions,
  type LineDiffOp,
  type LineDiffSegment,
} from './lines'

export {
  APPLY_DIFF_TOOL_NAME,
  ApplyDiffTool,
  applyDiffToFiles,
  type AppliedFile,
  type ApplyDiffInput,
  type ApplyDiffResultPayload,
  type FailedFile,
} from './applyDiffTool'

export {
  createApplyDiffPermissionHandler,
  defaultExtractApplyDiffPaths,
  type ApplyDiffPermissionConfig,
} from './applyDiffPermissionHook'
