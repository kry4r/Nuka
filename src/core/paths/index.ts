// src/core/paths/index.ts
//
// Public surface of the core/paths module.
//
// Layout helpers (~/.nuka directory structure) live in ./layout — they're the
// dominant legacy API and are re-exported first.
//
// Pure path-string formatting (tildify, displayPath, splitPath, etc.) lives in
// ./pathDisplay and is re-exported below.

export {
  tasksDir,
  nukaHome,
  teamsDir,
  recapsDir,
  forksDir,
  eventsDir,
  teamConfigPath,
  ensureNukaLayout,
} from './layout'

export {
  tildify,
  unhomedir,
  truncatePathMiddle,
  relativizeForDisplay,
  displayPath,
  splitPath,
  type TildifyOptions,
  type UnhomedirOptions,
  type TruncatePathMiddleOptions,
  type RelativizeForDisplayOptions,
  type DisplayPathOptions,
  type HomeOption,
  type SplitPathResult,
} from './pathDisplay'
