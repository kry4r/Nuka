// scripts/build.mjs
import { build } from 'esbuild'
import { chmod, readFile } from 'node:fs/promises'

// Read runtime dependencies from package.json and externalize them so esbuild
// does not bundle them. When the CLI is installed via `npm i -g` (or npx),
// these packages are present in node_modules and are resolved at runtime.
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const external = [...Object.keys(pkg.dependencies ?? {}), 'fsevents']

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
  external,
  logLevel: 'info',
})

await chmod('dist/cli.js', 0o755)
