// src/core/slug/index.ts
//
// Public surface of the slug / safe-name helpers. Pure logic, no UI deps.
// See `slug.ts` for the rationale.

export {
  slugify,
  safeFilename,
  safeBranchName,
  type SlugOptions,
  type SafeFilenameOptions,
  type SafeBranchOptions,
} from './slug'

export {
  SLUG_TOOL_NAME,
  SlugTool,
  runSlugTool,
  type SlugToolAction,
  type SlugToolInput,
  type SlugToolResult,
} from './slugTool'
