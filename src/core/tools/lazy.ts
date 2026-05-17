// src/core/tools/lazy.ts
//
// Lazy tool proxy — Phase P2 #12 bundle-size optimisation.
//
// ## Problem
//
// `dist/cli.js` ballooned to ~780 KB once every text-utility tool
// (whitespace, jsonFormat, urlExtract, slug, truncate, caseConvert,
// wordWrap, ansiStyle, textStats, codeBlocks, jsonEscape, duration,
// globMatch, ...) became an eager `import` at the top of `src/cli.tsx`.
// The bundle-size test caps `dist/cli.js` at 440 KB — long-term
// baseline-fail (see docs/plans/2026-05-17-nuka-feature-port-status.md
// §10 P2 #12).
//
// ## Approach (sidecar bundle + lazy proxy)
//
// 1. Heavy text-utility tools (no permission cost — `needsPermission`
//    constant = `'none'`) are moved into a SIDECAR esbuild bundle
//    `dist/tools-extra.js`. The main `dist/cli.js` no longer imports
//    them directly.
//
// 2. At boot, `cli.tsx` registers a LAZY PROXY for each: an object that
//    LOOKS like a `Tool` (full metadata — name, description,
//    parameters, tags, annotations, searchHint, aliases,
//    needsPermission) but whose `run()` performs a one-shot dynamic
//    `import('./tools-extra.js')` on first call, caches the resolved
//    real tool, then delegates.
//
// 3. The dynamic-import specifier is computed via `import.meta.url`
//    (and resolved through `pathToFileURL` for absolute paths) so
//    esbuild cannot statically resolve it — the heavy tool bytes stay
//    out of `dist/cli.js`. Same trick as the existing test-runner
//    bundle.
//
// 4. The proxy `IS` a `Tool` (identical surface), so `wrapWithHooks`
//    wraps it cleanly — every hook (beforeToolCall / afterToolCall /
//    pipeline replaceResult) fires exactly as before. The wrapper's
//    `run` calls the proxy's `run`, which calls the real tool's `run`.
//    Hook threading is unchanged.
//
// 5. Dev mode (`tsx src/cli.tsx`) doesn't ship a built sidecar — the
//    loader tries the sidecar URL first and falls back to importing
//    the source module via `new URL(srcRelative, import.meta.url)`,
//    matching the existing `--test-plan` fallback pattern.
//
// ## Invariants
//
// - `needsPermission` is SYNC (PermissionHint), so it MUST be inlined
//   in the proxy metadata — it runs before any tool load. All sidecar
//   tools therefore must have a CONSTANT permission shape. Tools whose
//   `needsPermission` is input-dependent (bash / edit / write /
//   applyDiff / findReplace) MUST stay eager.
//
// - `searchHint` / `aliases` / `tags` are consulted by ToolRegistry /
//   ToolSearch BEFORE any tool is invoked. They MUST be inlined.
//
// - The proxy preserves `name`, `description`, `parameters`, `source`,
//   `tags`, `annotations`, `searchHint`, `aliases` exactly — registry
//   queries (`list()`, `listSpecs()`, `bySource()`, `queryByTags()`)
//   are byte-for-byte identical.
//
// - First call latency: one dynamic `import()` (single sidecar; node
//   module cache means subsequent loads are free). Acceptable trade-off
//   per the plan.
//
// ## See also
//
// - `scripts/build.mjs` — emits `dist/tools-extra.js` alongside
//   `dist/cli.js` and `dist/test-runner.js`.
// - `src/cli.tsx` — registers the lazy proxies in place of the eager
//   imports.

import type { Tool, ToolContext, ToolResult, PermissionHint } from './types'

/**
 * Metadata required to construct a lazy tool proxy.
 *
 * This is the entire `Tool` shape EXCEPT `run` — everything the
 * registry, ToolSearch, ToolSummary, HookList, and permission checker
 * need at boot time, without loading the implementation.
 */
export type LazyToolMetadata<I> = Omit<Tool<I>, 'run' | 'needsPermission'> & {
  /**
   * Inlined permission hint. Must be a function (matching
   * `Tool.needsPermission`) so dynamic shape tools could in principle
   * use this layer too, but in practice all sidecar tools today return
   * a constant.
   */
  needsPermission: (input: I) => PermissionHint
}

/**
 * Loader returning the real Tool. Called at most once per proxy
 * (cached via `loaded` below). Should throw on failure — the proxy
 * propagates the error so the caller sees a normal tool failure.
 */
export type LazyToolLoader<I> = () => Promise<Tool<I>>

/**
 * Build a Tool whose `run` lazily loads the real implementation on
 * first call.
 *
 * The returned object is a fully-valid `Tool`:
 *
 * - `wrapWithHooks(makeLazyTool(meta, loader), reg)` works as expected.
 * - `ToolRegistry.register(makeLazyTool(meta, loader))` works.
 * - `ToolSearch` / `ToolSummary` see the inlined metadata.
 *
 * After the first successful call the resolved Tool is cached, so
 * subsequent calls have zero extra overhead beyond a property read.
 */
export function makeLazyTool<I>(
  meta: LazyToolMetadata<I>,
  loader: LazyToolLoader<I>,
): Tool<I> {
  let loaded: Tool<I> | undefined
  let loading: Promise<Tool<I>> | undefined

  const ensureLoaded = async (): Promise<Tool<I>> => {
    if (loaded) return loaded
    if (!loading) {
      loading = loader().then(t => {
        loaded = t
        return t
      })
    }
    return loading
  }

  return {
    ...meta,
    async run(input: I, ctx: ToolContext): Promise<ToolResult> {
      const real = await ensureLoaded()
      return real.run(input, ctx)
    },
  }
}
