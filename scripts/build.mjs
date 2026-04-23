// scripts/build.mjs
import { build } from 'esbuild'
import { chmod } from 'node:fs/promises'

// Stub `react-devtools-core` — ink imports it only under isDev() which is
// false in bundled production runs. Resolving it to an empty module avoids a
// bundle-time error without pulling in the actual devtools package.
const stubOptionalModulesPlugin = {
  name: 'stub-optional-modules',
  setup(build) {
    build.onResolve({ filter: /^react-devtools-core$/ }, (args) => ({
      path: args.path,
      namespace: 'stub-empty',
    }))
    build.onLoad({ filter: /.*/, namespace: 'stub-empty' }, () => ({
      contents: 'export default {}',
      loader: 'js',
    }))
  },
}

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
  external: [
    // Native / optional deps that should resolve at runtime.
    'fsevents',
  ],
  plugins: [stubOptionalModulesPlugin],
  logLevel: 'info',
})

await chmod('dist/cli.js', 0o755)
