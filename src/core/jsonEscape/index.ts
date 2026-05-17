// src/core/jsonEscape/index.ts
//
// Public surface of the string-transformation escape helpers. Pure
// logic — no UI deps, no filesystem, no network. See `jsonEscape.ts`
// for the rationale.

export {
  // JSON
  escapeJSON,
  quoteJSON,
  // Shell
  quoteShell,
  quoteShellArray,
  quoteShellWindows,
  type QuoteShellOptions,
  // Regex
  escapeRegex,
  type EscapeRegexOptions,
  // HTML
  escapeHtml,
  unescapeHtml,
  type EscapeHtmlOptions,
  // URL
  encodePathComponent,
  decodePathComponent,
  encodeQueryComponent,
  // Markdown
  escapeMarkdown,
  type EscapeMarkdownOptions,
} from './jsonEscape'
