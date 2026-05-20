// src/core/testing/explorer/L4_repair/verifyWorker.ts
//
// Worker entry-script for verify.ts (M6.P0 — Fix 2).
//
// This script runs inside a `worker_threads` Worker created by verify.ts.
// It receives { fixturePath, caseName, viewport, cwd } via `workerData`,
// imports all project modules and the fixture via tsImport (fresh ESM
// registry inside the worker), renders with renderWithViewport, parses with
// AnsiGrid.parse, runs runAll, then posts { clean, violations? } back via
// parentPort.
//
// **Why worker_threads (spec §4.6/§509 interpretation):**
//   Spec §509 says "no subprocess". worker_threads is NOT a subprocess:
//   it shares the same PID, inherits the same process memory model, and
//   runs in a separate V8 isolate. The "no subprocess" intent is to avoid
//   IPC overhead, spawn cost, and PATH-resolution surprises. A Worker
//   satisfies all three constraints while also giving us a fresh ESM module
//   registry per call — so transitive deps re-import fresh from disk.
//
// The worker is launched with `execArgv: ['--import', 'tsx']` which installs
// the tsx ESM loader hook inside the worker's V8 isolate.
//
// **Module resolution inside the worker:**
//   All project .ts/.tsx modules are loaded via `tsImport(absPath, ...)` with
//   explicit absolute paths. Relative bare specifiers (e.g. import('../L0/render'))
//   would require tsx's resolver to handle extension-less TypeScript paths, which
//   is not reliable inside a worker context. Explicit absolute paths + tsImport
//   are the authoritative pattern.

import { workerData, parentPort } from 'node:worker_threads'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FixtureDef, Viewport, Violation } from '../types'

type WorkerInput = {
  fixturePath: string
  caseName: string
  viewport: Viewport
  cwd: string
}

type WorkerOutput =
  | { clean: true }
  | { clean: false; violations: Violation[] }
  | { error: string }

async function run(): Promise<void> {
  const { fixturePath, caseName, viewport, cwd } = workerData as WorkerInput

  const absPath = path.isAbsolute(fixturePath)
    ? fixturePath
    : path.join(cwd, fixturePath)

  // Resolve the directory containing this worker script.
  // In source mode: .../src/core/testing/explorer/L4_repair/
  // In dist mode:   .../dist/  (verifyWorker.js lives alongside explorer.js)
  const selfDir = path.dirname(fileURLToPath(import.meta.url))

  // Load all project modules via tsImport with absolute paths.
  // This is necessary because bare relative imports without .ts extension
  // are not reliably handled by the tsx loader inside a Worker context.
  const { tsImport } = await import('tsx/esm/api')

  // Detect whether we're running from source or dist.
  // In dist mode the worker is already compiled JS; dynamic imports work
  // natively without tsImport for the bundled L0/L1 code. In source mode
  // we need tsImport for .ts resolution.
  const selfUrl = import.meta.url
  const isDist = selfUrl.endsWith('.js') || selfUrl.includes('/dist/')

  let renderWithViewport: typeof import('../L0/render').renderWithViewport
  let AnsiGrid: typeof import('../L0/grid').AnsiGrid
  let runAll: typeof import('../L1/index').runAll

  if (isDist) {
    // In dist mode, the bundle has all modules pre-compiled; use native import.
    const renderMod = await import('../L0/render')
    const gridMod = await import('../L0/grid')
    const l1Mod = await import('../L1/index')
    renderWithViewport = renderMod.renderWithViewport
    AnsiGrid = gridMod.AnsiGrid
    runAll = l1Mod.runAll
  } else {
    // In source mode, use tsImport with absolute .ts paths for reliable resolution.
    const renderMod = await tsImport(path.join(selfDir, '../L0/render.ts'), import.meta.url)
    const gridMod = await tsImport(path.join(selfDir, '../L0/grid.ts'), import.meta.url)
    const l1Mod = await tsImport(path.join(selfDir, '../L1/index.ts'), import.meta.url)
    renderWithViewport = renderMod.renderWithViewport
    AnsiGrid = gridMod.AnsiGrid
    runAll = l1Mod.runAll
  }

  // Load the fixture — always via tsImport so .tsx extension is handled and
  // the fixture gets a fresh registry entry (not cached from a previous call).
  let fixture: FixtureDef
  try {
    const mod = (await tsImport(absPath, import.meta.url)) as
      | { default?: FixtureDef }
      | FixtureDef
    const raw =
      'default' in (mod as object)
        ? (mod as { default?: FixtureDef }).default
        : mod
    if (!raw || typeof raw !== 'object') {
      throw new Error(
        `verifyWorker: ${absPath} default export is not a FixtureDef object`,
      )
    }
    fixture = raw as FixtureDef
  } catch (err) {
    const result: WorkerOutput = { error: String(err) }
    parentPort!.postMessage(result)
    return
  }

  const fixtureCase = fixture.cases[caseName]
  if (!fixtureCase) {
    const result: WorkerOutput = {
      error:
        `verifyWorker: case '${caseName}' not in fixture ${fixture.component} ` +
        `(known: ${Object.keys(fixture.cases).join(', ')})`,
    }
    parentPort!.postMessage(result)
    return
  }

  const handle = renderWithViewport(fixtureCase.render(), viewport)
  await new Promise<void>((r) => setImmediate(r))

  let result: WorkerOutput
  try {
    const frame = handle.lastFrame()
    const grid = AnsiGrid.parse(frame, viewport)
    const violations = runAll(grid, {
      viewport,
      staticWrites: handle.staticWrites(),
      cursorTraces: handle.cursorTraces(),
      fixtureCase,
    })
    if (violations.length === 0) {
      result = { clean: true }
    } else {
      result = { clean: false, violations }
    }
  } finally {
    handle.unmount()
  }

  parentPort!.postMessage(result!)
}

run().catch((err) => {
  const result: WorkerOutput = { error: String(err) }
  parentPort!.postMessage(result)
})
