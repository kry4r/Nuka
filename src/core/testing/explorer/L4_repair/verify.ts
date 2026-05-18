// src/core/testing/explorer/L4_repair/verify.ts
//
// M5.T2 — in-process re-mount + L0/L1 verification of a single fixture
// case at a single viewport. See locked spec §4.6 step 3.
//
// **Hard constraint (plan §509):** verify MUST NOT spawn a subprocess.
// No subprocess imports at all — keep this file's import list pure
// node:fs/path plus the explorer's own L0/L1 modules. The whole flow
// runs in the calling process so the repair subagent can iterate
// quickly inside one Anthropic-API-priced session.
//
// **Module-cache strategy (ESM limitation note):**
//   ESM modules cannot be evicted from the registry from userland — Node's
//   spec deliberately omits that surface. tsImport's namespace API was
//   designed to re-evaluate, but in practice Node's module loader caches
//   the URL→source mapping at a layer below tsx, so calling tsImport
//   twice on the same path returns the same content. The robust workaround
//   is to load the fixture from a UNIQUELY-NAMED copy each call — that
//   path has never been seen by the loader so the cache key misses, the
//   file is read fresh from disk, and tsx re-evaluates with the latest
//   bytes. The copy sits in the fixture's own directory so relative
//   imports inside the fixture continue to resolve from the same point.
//
// Transitive module note: edits to files imported BY the fixture (e.g. a
// component module the fixture re-exports) still hit the underlying ESM
// registry's cached entries for those *original* paths. Verify only
// guarantees fresh evaluation of the entry fixture file. Subagent edits
// to deeper source files require the caller to either round-trip through
// a copy (not done here) or accept that the verify result reflects the
// process snapshot at startup for transitive deps.

import { copyFileSync, existsSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { renderWithViewport } from '../L0/render'
import { AnsiGrid } from '../L0/grid'
import { runAll } from '../L1/index'
import type { FixtureDef, Viewport, Violation } from '../types'

export type VerifyOpts = {
  fixturePath: string
  caseName: string
  viewport: Viewport
  cwd: string
}

export type VerifyResult =
  | { clean: true }
  | { clean: false; violations: Violation[] }

/**
 * Mount one fixture-case at one viewport, run L1 invariants, return the
 * pass/fail JSON. No subprocess, no shell, no spawn — pure in-process.
 *
 * @throws if `fixturePath` does not exist, is not loadable as a FixtureDef,
 *         or `caseName` is not present in the fixture's `cases` map.
 */
export async function verify(opts: VerifyOpts): Promise<VerifyResult> {
  const { fixturePath, caseName, viewport, cwd } = opts

  const absPath = path.isAbsolute(fixturePath)
    ? fixturePath
    : path.join(cwd, fixturePath)

  if (!existsSync(absPath)) {
    throw new Error(`verify: fixture not found: ${absPath}`)
  }

  const fixture = await loadFixtureFresh(absPath)
  const fixtureCase = fixture.cases[caseName]
  if (!fixtureCase) {
    throw new Error(
      `verify: case '${caseName}' not in fixture ${fixture.component} ` +
        `(known: ${Object.keys(fixture.cases).join(', ')})`,
    )
  }

  const handle = renderWithViewport(fixtureCase.render(), viewport)
  // Tiny settle so the first frame is committed before we parse the grid.
  // We don't run a fuzz loop here so a single setImmediate is sufficient.
  await new Promise<void>((r) => setImmediate(r))

  try {
    const frame = handle.lastFrame()
    const grid = AnsiGrid.parse(frame, viewport)
    const violations = runAll(grid, {
      viewport,
      staticWrites: handle.staticWrites(),
      fixtureCase,
    })

    if (violations.length === 0) return { clean: true }
    return { clean: false, violations }
  } finally {
    handle.unmount()
  }
}

/**
 * Load a fixture file with a fresh evaluation each call. We copy the
 * source to a uniquely-named sibling, import THAT path (so Node's loader
 * has never seen this URL before), then delete the copy.
 *
 * The copy lives in the same directory as the original so any relative
 * imports inside the fixture (e.g. `import x from '../../src/...'`)
 * resolve from the same point and behave identically.
 */
async function loadFixtureFresh(absPath: string): Promise<FixtureDef> {
  const dir = path.dirname(absPath)
  const ext = path.extname(absPath)
  const uniq = `.verify-tmp-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}${ext}`
  const copyPath = path.join(dir, uniq)

  copyFileSync(absPath, copyPath)

  let raw: unknown
  try {
    // Native import first — under vitest, Vite handles .tsx transforms
    // per-URL, so a unique copy path forces a fresh transform. Under the
    // compiled dist runtime the tsx ESM hook (see commit 5d9693b) handles
    // the resolve. tsImport is the fallback for environments where neither
    // hook is installed.
    try {
      const mod = (await import(copyPath)) as
        | { default?: FixtureDef }
        | FixtureDef
      raw =
        'default' in (mod as object)
          ? (mod as { default?: FixtureDef }).default
          : mod
    } catch {
      const { tsImport } = await import('tsx/esm/api')
      const mod = (await tsImport(copyPath, import.meta.url)) as
        | { default?: FixtureDef }
        | FixtureDef
      raw =
        'default' in (mod as object)
          ? (mod as { default?: FixtureDef }).default
          : mod
    }
  } finally {
    try {
      unlinkSync(copyPath)
    } catch {
      /* best-effort */
    }
  }

  if (!raw || typeof raw !== 'object') {
    throw new Error(
      `verify: ${absPath} default export is not a FixtureDef object`,
    )
  }
  return raw as FixtureDef
}
