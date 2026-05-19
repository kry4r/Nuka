#!/usr/bin/env node
/**
 * scripts/mimo-capture-frame.mjs
 *
 * Uses the ink-ui-explorer's `capture` verb (from dist/explorer.js) with the
 * _fixtureDef backdoor to render the mimo-dogfood fixture at viewport 80×24
 * and write the ASCII frame to a file.
 *
 * This works around the gap in `nuka explore capture <file.tsx>` that doesn't
 * call tsx.register() before loading .tsx files.
 *
 * Usage: node --import=tsx/esm scripts/mimo-capture-frame.mjs
 */

import { pathToFileURL } from 'node:url'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')

// Load fixture via tsx-registered loader (invoked with --import=tsx/esm)
const fixturePath = join(repoRoot, 'test', 'ui-auto', 'fixtures', 'mimo-dogfood-response.fixtures.tsx')
const mod = await import(pathToFileURL(fixturePath).href)
const fixtureDef = mod.default ?? mod

// Load the capture verb from dist/explorer.js
const explorerPath = join(repoRoot, 'dist', 'explorer.js')
const { capture } = await import(pathToFileURL(explorerPath).href)

const viewport = { cols: 80, rows: 24 }
const outDir = join(repoRoot, '.ink-explorer', 'runs', 'mimo-dogfood')

// Use the _fixtureDef backdoor (CaptureOptsExtended internal API)
const result = await capture({
  fixturePath: '',
  _fixtureDef: fixtureDef,
  viewport,
  cwd: repoRoot,
  out: outDir,
})

process.stdout.write(`\ncapturePath: ${result.capturePath}\n`)
process.stdout.write(`grids rendered: ${result.grids.length}\n`)
