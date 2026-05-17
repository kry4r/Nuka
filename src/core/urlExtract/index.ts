// src/core/urlExtract/index.ts
//
// Public surface of the URL / link extractor. Pure logic — no UI deps.
// See `urlExtract.ts` for the rationale and edge-case coverage.

export {
  extractUrls,
  isUrl,
  replaceUrls,
  extractMarkdownLinks,
  type UrlMatch,
  type UrlKind,
  type ExtractUrlOptions,
  type MarkdownLink,
} from './urlExtract'

export {
  URL_EXTRACT_TOOL_NAME,
  UrlExtractTool,
  runUrlExtractTool,
  type UrlExtractAction,
  type UrlExtractToolInput,
  type UrlExtractToolResult,
  type UrlExtractMarkdownLink,
} from './urlExtractTool'

export {
  createUrlExtractHandler,
  DEFAULT_URL_EXTRACT_HOOK_MAX_URLS,
  DEFAULT_URL_EXTRACT_HOOK_MIN_LENGTH,
  type UrlExtractHookConfig,
} from './urlExtractHook'
