// src/core/fileSearch/index.ts
//
// Public API for the fileSearch module.
//
// Use cases:
//   - palette / typeahead UI                → buildIndexFromDir + index.search
//   - one-shot path lookup                  → searchPaths
//   - score a single candidate              → scorePath
//   - already have a path list (from git,
//     ripgrep, watcher) → FileIndex
//     + loadFromFileList[Async]
//
// See individual file headers for full details on the tradeoffs.

export { FileIndex, scorePath, yieldToEventLoop } from './fileIndex.js'
export type { SearchResult } from './fileIndex.js'
export { DEFAULT_SKIP_DIRS, walkFiles } from './walker.js'
export type { WalkOptions } from './walker.js'
export {
  buildIndexFromDir,
  promoteRecent,
  searchPaths,
} from './searchPaths.js'
export type { SearchPathsOptions } from './searchPaths.js'
export {
  createGitignoreFilter,
  gitignoreFilter,
  loadGitignorePatterns,
} from './gitignoreFilter.js'
export {
  RecentFiles,
  createPersistentRecentFiles,
  defaultRecentFilesPath,
  loadRecentFiles,
  persistRecentFiles,
} from './recentFiles.js'
export type {
  PersistentRecentFiles,
  RecentFileEntry,
  RecentFilesJSON,
  RecentFilesOptions,
} from './recentFiles.js'
export {
  FILE_SEARCH_DEFAULT_MAX,
  FILE_SEARCH_HARD_MAX,
  FILE_SEARCH_TOOL_NAME,
  FileSearchTool,
  runFileSearch,
} from './fileSearchTool.js'
export type {
  FileSearchInput,
  FileSearchMatch,
  FileSearchResult,
} from './fileSearchTool.js'
export {
  RECENT_FILES_DEFAULT_LIMIT,
  RECENT_FILES_HARD_LIMIT,
  RECENT_FILES_TOOL_NAME,
  makeRecentFilesTool,
} from './recentFilesTool.js'
export {
  RECENT_FILES_TRACKED_TOOLS,
  createRecentFilesTouchHandler,
} from './recentFilesHook.js'
export type {
  RecentFilesAction,
  RecentFilesClearResult,
  RecentFilesForgetResult,
  RecentFilesInput,
  RecentFilesListItem,
  RecentFilesListResult,
  RecentFilesResult,
  RecentFilesTouchResult,
} from './recentFilesTool.js'
