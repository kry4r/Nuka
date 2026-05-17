// src/core/caseConvert/index.ts
//
// Public surface of the caseConvert helpers. Pure logic, no UI deps.
// See `caseConvert.ts` for the rationale and edge cases.

export {
  toCamelCase,
  toPascalCase,
  toKebabCase,
  toSnakeCase,
  toConstantCase,
  toTitleCase,
  toLowerCase,
  detectCase,
  splitWords,
  type CaseOptions,
  type CaseStyle,
} from './caseConvert'

export {
  CASE_CONVERT_TOOL_NAME,
  CaseConvertTool,
  runCaseConvertTool,
  type CaseConvertAction,
  type CaseConvertToolInput,
  type CaseConvertToolResult,
} from './caseConvertTool'
