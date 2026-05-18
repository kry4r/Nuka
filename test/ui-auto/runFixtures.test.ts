// test/ui-auto/runFixtures.test.ts
//
// Shim that globs test/ui-auto/fixtures/**/*.fixtures.tsx, loads each
// FixtureDef, and runs every case through renderWithViewport + L1 invariants
// + any fixture-level assert() hook.
//
// Regression Bug A and Bug B fixtures are marked it.fails() so vitest
// exits 0 at HEAD while the fixtures stay red — M9 (repair) flips them
// to it() when the underlying bugs are fixed.

import { describe, it, expect } from 'vitest'
import path from 'path'
import { glob } from 'tinyglobby'
import type { FixtureDef, FixtureCase, Viewport } from '../../src/core/testing/explorer/types'
import { renderWithViewport } from '../../src/core/testing/explorer/L0/render'
import { runAll } from '../../src/core/testing/explorer/L1/index'

const FIXTURES_DIR = path.join(__dirname, 'fixtures')
const DEFAULT_VIEWPORT: Viewport = { cols: 80, rows: 24 }

async function loadFixtures(): Promise<Array<{ file: string; def: FixtureDef }>> {
  const files = await glob('**/*.fixtures.tsx', { cwd: FIXTURES_DIR, absolute: true })
  const defs: Array<{ file: string; def: FixtureDef }> = []
  for (const file of files.sort()) {
    const mod = await import(file) as { default: FixtureDef }
    if (mod.default) {
      defs.push({ file, def: mod.default })
    }
  }
  return defs
}

async function runFixtureCase(
  fixtureCase: FixtureCase,
  viewport: Viewport = DEFAULT_VIEWPORT,
): Promise<void> {
  const node = fixtureCase.render()
  const handle = renderWithViewport(node, viewport)
  await new Promise<void>(resolve => setImmediate(resolve))

  const frame = handle.lastFrame()
  handle.unmount()

  const grid = handle.grid(frame)
  const violations = runAll(grid, {
    viewport,
    staticWrites: handle.staticWrites(),
    fixtureCase,
  })

  if (violations.some(v => v.severity === 'error')) {
    const msgs = violations
      .filter(v => v.severity === 'error')
      .map(v => `[${v.rule}] ${v.message}`)
      .join('\n')
    throw new Error(`L1 invariant violations:\n${msgs}`)
  }

  // Run fixture-level assert hook if present
  if (fixtureCase.assert) {
    await fixtureCase.assert(handle)
  }
}

// ---------------------------------------------------------------------------
// Discovery + dispatch
// ---------------------------------------------------------------------------

describe('ui-auto fixtures', () => {
  // Bug A fixtures — currently RED at HEAD (no "When NOT to use" in description,
  // no TodoWrite section in systemPrompt). Marked it.fails() so vitest exits 0.
  it.fails('regression-bug-a: tool-description-has-when-not-to-use', async () => {
    const fixtures = await loadFixtures()
    const bugA = fixtures.find(f => f.file.includes('regression-bug-a'))
    expect(bugA, 'regression-bug-a fixture not found').toBeDefined()
    const c = bugA!.def.cases['tool-description-has-when-not-to-use']
    expect(c, 'case not found').toBeDefined()
    await runFixtureCase(c!)
  })

  it.fails('regression-bug-a: system-prompt-has-todowrite-section', async () => {
    const fixtures = await loadFixtures()
    const bugA = fixtures.find(f => f.file.includes('regression-bug-a'))
    expect(bugA, 'regression-bug-a fixture not found').toBeDefined()
    const c = bugA!.def.cases['system-prompt-has-todowrite-section']
    expect(c, 'case not found').toBeDefined()
    await runFixtureCase(c!)
  })

  // Bug B fixtures — currently RED at HEAD.
  it.fails('regression-bug-b: b1-layout-mode-at-79-cols', async () => {
    const fixtures = await loadFixtures()
    const bugB = fixtures.find(f => f.file.includes('regression-bug-b'))
    expect(bugB, 'regression-bug-b fixture not found').toBeDefined()
    const c = bugB!.def.cases['b1-layout-mode-at-79-cols']
    expect(c, 'case not found').toBeDefined()
    await runFixtureCase(c!, { cols: 79, rows: 24 })
  })

  it.fails('regression-bug-b: b2-prologue-not-in-static-when-total-gt-0', async () => {
    const fixtures = await loadFixtures()
    const bugB = fixtures.find(f => f.file.includes('regression-bug-b'))
    expect(bugB, 'regression-bug-b fixture not found').toBeDefined()
    const c = bugB!.def.cases['b2-prologue-not-in-static-when-total-gt-0']
    expect(c, 'case not found').toBeDefined()
    await runFixtureCase(c!)
  })
})
