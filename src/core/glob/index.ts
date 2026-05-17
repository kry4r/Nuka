// src/core/glob/index.ts
//
// Public surface of the minimal glob matcher. Pure logic, no UI deps,
// no filesystem. See `glob.ts` for the rationale and full docs.

export {
  compileGlob,
  matchesGlob,
  globToRegex,
  expandBraces,
  type GlobOptions,
  type GlobMatcher,
} from './glob'

export {
  GLOB_MATCH_TOOL_NAME,
  GlobMatchTool,
  runGlobMatchTool,
  type GlobMatchAction,
  type GlobMatchInput,
  type GlobMatchResult,
} from './globTool'
