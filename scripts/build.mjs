// scripts/build.mjs
//
// Phase 10 §4.1 — two-bundle split:
//   * dist/cli.js         — production CLI; testing modules externalized.
//   * dist/test-runner.js — re-exports parsePlan/runPlan + runTestPlanCli;
//                           lazy-loaded by cli.tsx only on `--test-plan`.
//
// `cli.tsx` imports the test-runner via a runtime-computed URL
// (`new URL('./test-runner.js', import.meta.url)`) so esbuild cannot
// statically resolve the dynamic-import call. The `external` entry below
// is belt-and-suspenders should that pattern ever change to a literal.
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
  // Externalize the lazy-loaded test-runner bundle (relative to dist/cli.js).
  // The cli.tsx dynamic import uses a URL-computed specifier so esbuild
  // already cannot resolve it; this entry is defensive.
  external: [...runtimeExternals, './test-runner.js'],
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
