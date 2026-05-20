// src/core/testing/explorer/capture.ts
//
// L0 Capture verb — M1 implementation.
// See locked spec §4.1 for the full design.
//
// Flow:
//  1. Load fixture: either _fixtureDef (inline) or dynamic import(fixturePath).
//  2. For each requested case, call renderWithViewport → AnsiGrid.parse.
//  3. Run L1.runAll against each grid.
//  4. Write <id>.txt (asciiView) + <id>.json (record) to out/captures/.

import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'node:url'
import type { CaptureOpts, CaptureResult, FixtureDef, Viewport } from './types'
import { renderWithViewport } from './L0/render'
import { AnsiGrid } from './L0/grid'
import { runAll } from './L1/index'
import { ensureTsxRegistered } from './sweep/fixtureLoader'

// file-local: extends CaptureOpts with the _fixtureDef test backdoor; do not export
// Callers that need to pass _fixtureDef should cast via `as Parameters<typeof capture>[0]`.
type CaptureOptsExtended = CaptureOpts & {
  _fixtureDef?: FixtureDef
}

/**
 * Mount a single fixture at one viewport and write the ASCII grid + grid JSON
 * to `.ink-explorer/captures/<id>.txt` + `<id>.json`.
 * Returns the result containing all rendered grids and the capturePath.
 */
export async function capture(opts: CaptureOptsExtended): Promise<CaptureResult> {
  const {
    fixturePath,
    caseName,
    viewport = { cols: 80, rows: 24 },
    cwd = process.cwd(),
    out,
    _fixtureDef,
  } = opts

  const outDir = out ?? path.join(cwd, '.ink-explorer')
  const capturesDir = path.join(outDir, 'captures')
  fs.mkdirSync(capturesDir, { recursive: true })

  // 1. Load fixture
  let fixtureDef: FixtureDef
  if (_fixtureDef) {
    fixtureDef = _fixtureDef
  } else {
    await ensureTsxRegistered()
    const mod = await import(pathToFileURL(fixturePath).href) as { default?: FixtureDef } | FixtureDef
    fixtureDef = ('default' in mod && mod.default ? mod.default : mod) as FixtureDef
  }

  // 2. Determine which cases to run
  const allCaseNames = Object.keys(fixtureDef.cases)
  const caseNames = caseName ? [caseName] : allCaseNames
  if (caseNames.length === 0) throw new Error('No cases found in fixture')

  // 3. Render each case
  const grids = []
  let lastCapturePath = ''

  for (const cn of caseNames) {
    const fixtureCase = fixtureDef.cases[cn]
    if (!fixtureCase) throw new Error(`Case '${cn}' not found in fixture`)

    const node = fixtureCase.render()
    const vp: Viewport = viewport

    // Mount, wait a tick for initial paint, grab frame
    const handle = renderWithViewport(node, vp)
    await new Promise<void>(resolve => setImmediate(resolve))

    const frame = handle.lastFrame()
    handle.unmount()

    const grid = AnsiGrid.parse(frame, vp)
    grids.push(grid)

    // Run L1 invariants (record violations but don't throw)
    const violations = runAll(grid, {
      viewport: vp,
      staticWrites: handle.staticWrites(),
      cursorTraces: handle.cursorTraces(),
      fixtureCase,
    })

    // 4. Write output files
    const componentName = fixtureDef.component.toLowerCase().replace(/[^a-z0-9]/g, '-')
    const id = `${componentName}-${cn}-${vp.cols}x${vp.rows}`
    const txtPath = path.join(capturesDir, `${id}.txt`)
    const jsonPath = path.join(capturesDir, `${id}.json`)

    fs.writeFileSync(txtPath, grid.asciiView, 'utf8')
    fs.writeFileSync(
      jsonPath,
      JSON.stringify(
        {
          id,
          component: fixtureDef.component,
          caseName: cn,
          viewport: vp,
          hash: grid.hash,
          asciiView: grid.asciiView,
          boxes: grid.boxes,
          violations,
          capturedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf8',
    )

    lastCapturePath = txtPath
    // Also print the ASCII view to stdout (CLI UX)
    process.stdout.write(`[capture] ${id}\n${grid.asciiView}\n`)
  }

  return {
    grids,
    capturePath: lastCapturePath,
  }
}
