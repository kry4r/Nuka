// src/core/whitespace/index.ts
//
// Public surface of the whitespace helpers. Pure logic, no UI deps.
// See `whitespace.ts` for the rationale and edge cases.

export {
  normalizeLineEndings,
  trimTrailingWhitespace,
  trimLeadingBlankLines,
  trimTrailingBlankLines,
  trimBlankLines,
  collapseBlankLines,
  expandTabs,
  unexpandTabs,
  dedent,
  normalize,
  type LineEndingStyle,
  type NormalizeLineEndingsOptions,
  type CollapseBlankLinesOptions,
  type ExpandTabsOptions,
  type UnexpandTabsOptions,
  type DedentOptions,
  type NormalizeOptions,
} from './whitespace'

export {
  WhitespaceTool,
  WHITESPACE_TOOL_NAME,
  runWhitespaceTool,
  type WhitespaceAction,
  type WhitespaceToolInput,
  type WhitespaceToolResult,
} from './whitespaceTool'
