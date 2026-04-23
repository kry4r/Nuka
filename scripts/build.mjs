// scripts/build.mjs
import { build } from 'esbuild'
import { chmod } from 'node:fs/promises'

await build({
  entryPoints: ['src/cli.tsx'],
  outfile: 'dist/cli.js',
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  jsx: 'automatic',
  banner: { js: '#!/usr/bin/env node' },
  external: [
    // Native / optional deps that should resolve at runtime.
    'fsevents',
  ],
  logLevel: 'info',
})

await chmod('dist/cli.js', 0o755)
