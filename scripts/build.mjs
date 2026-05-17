// scripts/build.mjs
//
// Phase 10 §4.1 — bundle split.  Phase P2 #12 (2026-05-17) — extended.
//
//   * dist/cli.js         — production CLI; testing + heavy text-utility
//                           tool modules externalized.
//   * dist/test-runner.js — re-exports parsePlan/runPlan + runTestPlanCli;
//                           lazy-loaded by cli.tsx only on `--test-plan`.
//   * dist/tools-extra.js — heavy text-utility tools (whitespace, slug,
//                           truncate, jsonFormat, urlExtract, duration,
//                           caseConvert, wordWrap, ansiStyle, textStats,
//                           codeBlocks, shellQuote, globMatch). Lazy-
//                           loaded by `src/cli.tsx` on the first invocation
//                           of any of those tools (see core/tools/lazy.ts).
//
// `cli.tsx` imports BOTH sidecar bundles via a runtime-computed URL
// (`new URL('./<name>.js', import.meta.url)`) so esbuild cannot statically
// resolve the dynamic-import call. The `external` entries below are
// belt-and-suspenders should that pattern ever change to a literal.
import { build } from 'esbuild'
import { chmod, readFile } from 'node:fs/promises'

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const runtimeExternals = [...Object.keys(pkg.dependencies ?? {}), 'fsevents']

// ----------------------------- production cli ------------------------------
await build({
  entryPoints: ['src/cli.tsx'],
  outfile: 'dist/cli.js',
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  jsx: 'automatic',
  banner: {
    js: [
      '#!/usr/bin/env node',
      // Provide `require` for bundled CJS modules (e.g. signal-exit) that
      // call `require(...)` dynamically from within an ESM bundle.
      "import { createRequire as __nuka_createRequire } from 'node:module';",
      'const require = __nuka_createRequire(import.meta.url);',
    ].join('\n'),
  },
  // Externalize the lazy-loaded sidecar bundles (relative to dist/cli.js).
  // The cli.tsx dynamic imports use URL-computed specifiers so esbuild
  // already cannot resolve them; these entries are defensive in case the
  // pattern ever changes to a literal string.
  external: [...runtimeExternals, './test-runner.js', './tools-extra.js'],
  // Strip whitespace + comments (no identifier/syntax minification) so the
  // production bundle is dense without being unreadable. This keeps
  // dist/cli.js comfortably under the Phase-10 320 KB ceiling.
  minifyWhitespace: true,
  legalComments: 'none',
  logLevel: 'info',
})

await chmod('dist/cli.js', 0o755)

// ---------------------------- test-runner bundle ---------------------------
await build({
  entryPoints: ['src/core/testing/cli-entry.ts'],
  outfile: 'dist/test-runner.js',
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  jsx: 'automatic',
  banner: {
    js: [
      "import { createRequire as __nuka_createRequire } from 'node:module';",
      'const require = __nuka_createRequire(import.meta.url);',
    ].join('\n'),
  },
  external: runtimeExternals,
  logLevel: 'info',
})

// ---------------------------- tools-extra bundle ---------------------------
// Phase P2 #12 — sidecar for heavy text-utility tools.
// cli.tsx lazy-loads this bundle via `new URL('./tools-extra.js',
// import.meta.url)` on first call to any contained tool; the metadata
// table in `core/tools/extra/lazyMetas.ts` lets the registry stay
// synchronous at boot.
await build({
  entryPoints: ['src/core/tools/extra/entry.ts'],
  outfile: 'dist/tools-extra.js',
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  jsx: 'automatic',
  banner: {
    js: [
      "import { createRequire as __nuka_createRequire } from 'node:module';",
      'const require = __nuka_createRequire(import.meta.url);',
    ].join('\n'),
  },
  external: runtimeExternals,
  minifyWhitespace: true,
  legalComments: 'none',
  logLevel: 'info',
})
