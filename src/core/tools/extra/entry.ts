// src/core/tools/extra/entry.ts
//
// Entry module for the `dist/tools-extra.js` sidecar bundle (Phase P2
// #12 bundle-size optimisation — see `src/core/tools/lazy.ts` for the
// full rationale).
//
// Re-exports every "heavy text-utility tool" that
//
//   1. has a CONSTANT `needsPermission` (so the proxy can inline the
//      hint without loading the impl), and
//   2. has no module-level side effects that need to fire at boot
//      (so the lazy load doesn't change app behaviour), and
//   3. contributes meaningfully to `dist/cli.js` size (top-N by
//      `bytesInOutput` per the esbuild metafile).
//
// `src/cli.tsx` does NOT import this file directly — it dynamic-imports
// `dist/tools-extra.js` via an `import.meta.url`-computed URL so esbuild
// cannot resolve the call and the heavy modules stay out of the main
// bundle. The dev-mode fallback in cli.tsx imports this `.ts` file
// directly when no built sidecar is present.

export { WhitespaceTool } from '../../whitespace/whitespaceTool'

// Factory tools (need DI from cli.tsx via loader closure) — see
// `core/tools/extra/lazyMetas.ts` LAZY_FACTORY_TOOL_ENTRIES.
export { makeLspQueryTool } from '../../lsp/lspQueryTool'

// Tools whose `needsPermission` depends on input (proxy inlines the
// predicate; impl lives in the sidecar).
export { ApplyDiffTool } from '../../diff/applyDiffTool'
export { FindReplaceTool } from '../../findReplace/findReplaceTool'
export { TruncateTool } from '../../truncate/truncateTool'
export { JsonFormatTool } from '../../jsonFormat/jsonFormatTool'
export { ShellQuoteTool } from '../../jsonEscape/shellQuoteTool'
export { SlugTool } from '../../slug/slugTool'
export { UrlExtractTool } from '../../urlExtract/urlExtractTool'
export { FormatDurationTool } from '../../duration/durationTool'
export { CaseConvertTool } from '../../caseConvert/caseConvertTool'
export { WrapTextTool } from '../../wordWrap/wrapTextTool'
export { AnsiStyleTool } from '../../ansi/ansiStyleTool'
export { TextStatsTool } from '../../textStats/textStatsTool'
export { CodeBlocksTool } from '../../codeBlocks/codeBlocksTool'
export { GlobMatchTool } from '../../glob/globTool'
