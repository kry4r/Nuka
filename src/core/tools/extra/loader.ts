// src/core/tools/extra/loader.ts
//
// Lazy loader for the `dist/tools-extra.js` sidecar bundle (Phase P2
// #12 bundle-size optimisation — see `src/core/tools/lazy.ts`).
//
// The sidecar holds the heavy text-utility tool implementations. We
// dynamic-import it via `new URL('./tools-extra.js', import.meta.url)`
// so esbuild cannot statically resolve the specifier — that's what
// keeps the heavy modules out of `dist/cli.js`.
//
// Dev mode (`tsx src/cli.tsx`) doesn't ship a built sidecar; we fall
// back to importing the source `entry.ts` directly via a similarly
// URL-computed specifier. This matches the existing `--test-plan`
// fallback in cli.tsx.
//
// The loader is process-singleton and memoised — every lazy tool
// shares the same module promise, so we pay at most ONE dynamic
// import even when several lazy tools fire in parallel.

import type * as SidecarEntry from './entry'

/**
 * Shape of the sidecar module. Adding a new lazy tool means:
 *   1. exporting it from `entry.ts`,
 *   2. extending the metadata table in `lazyMetas.ts`,
 *   3. wiring `tools.register(makeLazyTool(meta, () => load('Foo')))`
 *      in `src/cli.tsx`.
 *
 * The types compose so the loader is end-to-end type-safe — a typo
 * in step 3 trips the compiler.
 */
type SidecarModule = typeof SidecarEntry

let pending: Promise<SidecarModule> | undefined

/**
 * Load the sidecar module, memoised. Tries the built `tools-extra.js`
 * first (production) and falls back to the in-tree source (dev).
 *
 * Both URL specifiers are computed at call-time so esbuild's static
 * analysis can't reach them. The whole point of the sidecar is that
 * `dist/cli.js` must NOT bundle these modules — keep the specifiers
 * dynamic.
 */
export function loadToolsExtraModule(): Promise<SidecarModule> {
  if (pending) return pending
  pending = (async () => {
    const distUrl = new URL('./tools-extra.js', import.meta.url).href
    try {
      return (await import(distUrl)) as SidecarModule
    } catch {
      // Dev fallback — running `tsx src/cli.tsx` without a build.
      const srcUrl = new URL('./entry.ts', import.meta.url).href
      return (await import(srcUrl)) as SidecarModule
    }
  })()
  return pending
}

/**
 * Convenience: load a single named export from the sidecar. Bound at
 * lazy-tool construction time inside `cli.tsx`.
 */
export async function loadToolFromSidecar<K extends keyof SidecarModule>(
  exportName: K,
): Promise<SidecarModule[K]> {
  const mod = await loadToolsExtraModule()
  return mod[exportName]
}

/**
 * Reset the memoised module promise. Test-only — invoked by unit tests
 * that need to exercise the cold-start path more than once. Not exposed
 * as part of the public surface (the loader has no need for it at
 * runtime; the node module cache makes the second `import()` a no-op
 * anyway).
 */
export function __resetSidecarCacheForTests(): void {
  pending = undefined
}
