// src/core/wordWrap/index.ts
//
// Public surface of the word-wrap helpers. Pure logic, no UI deps.
// See `wordWrap.ts` for the rationale.

export {
  wrapText,
  wrapLines,
  wrapWithPrefix,
  type WrapOptions,
  type WrapWithPrefixOptions,
} from './wordWrap'

export {
  WRAP_TEXT_TOOL_NAME,
  WrapTextTool,
  runWrapText,
  type WrapTextAction,
  type WrapTextInput,
  type WrapTextResult,
} from './wrapTextTool'
