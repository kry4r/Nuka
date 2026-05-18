// test/core/testing/explorer/fuzz.test.ts
//
// M3.T3 — RED-first tests for the fuzz() orchestrator.
// See locked spec §4.4.
//
// 2 tests:
//   1. determinism — same seed + same fixture → identical FuzzResult twice.
//   2. crafted fixture: bug fires on byte 'q' → fuzz finds violation within
//      ≤ 50 steps; shrunk repro has length 1 == ['q'].
//
// The crafted fixture is materialised on disk in a dot-prefixed tmp dir
// (./.tmp-fuzz-test/) that lives under .gitignore. afterEach + afterAll
// both call cleanup to satisfy the test-temp-cleanup memory rule.

import { describe, it, expect, afterEach, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import { Text } from 'ink'
import type { FixtureDef } from '../../../../src/core/testing/explorer/types'
import { fuzz } from '../../../../src/core/testing/explorer/fuzz'

// ---------------------------------------------------------------------------
// Tmp scratch dir — dot-prefixed + .gitignored.
// ---------------------------------------------------------------------------
const TMP_DIR = path.join(process.cwd(), '.tmp-fuzz-test')

function ensureTmp(): void {
  fs.mkdirSync(TMP_DIR, { recursive: true })
}

function cleanup(): void {
  fs.rmSync(TMP_DIR, { recursive: true, force: true })
}

afterEach(cleanup)
afterAll(cleanup)

// ---------------------------------------------------------------------------
// writeQuitFixture — emits a .fixtures.tsx file with a component that breaks
// on byte 'q'. We use `mustContain` so the L1 noLossyTruncation invariant
// fires deterministically when the marker disappears.
// ---------------------------------------------------------------------------
function writeQuitFixture(): string {
  ensureTmp()
  const filePath = path.join(TMP_DIR, 'quitbug.fixtures.tsx')
  fs.writeFileSync(
    filePath,
    `import React from 'react'
import { Text, useInput } from 'ink'

function QuitBug() {
  const [broken, setBroken] = React.useState(false)
  useInput((input) => {
    if (input === 'q') setBroken(true)
  })
  return React.createElement(Text, null, broken ? 'BROKEN' : 'OK-MARKER')
}

const fixture = {
  component: 'QuitBug',
  cases: {
    fuzz: {
      render: () => React.createElement(QuitBug),
      mustContain: ['OK-MARKER'],
    },
  },
  viewports: [{ cols: 40, rows: 10 }],
}

export default fixture
`,
    'utf8',
  )
  return filePath
}

// ---------------------------------------------------------------------------
// Clean fixture for determinism check — never violates any invariant.
// ---------------------------------------------------------------------------
function makeCleanFixture(): FixtureDef {
  // Using a render() closure → cannot live on disk. Use the _fixtureDef
  // backdoor (matches capture.ts / sweep.ts test pattern).
  return {
    component: 'CleanFixture',
    cases: {
      always: {
        render: () => React.createElement(Text, null, 'hello'),
      },
    },
    viewports: [{ cols: 40, rows: 10 }],
  }
}

// ---------------------------------------------------------------------------
// 1. Determinism — same seed + same fixture → identical result twice
// ---------------------------------------------------------------------------
describe('fuzz — determinism', () => {
  it('same seed + same fixture → identical FuzzResult across two runs', async () => {
    const fixture = makeCleanFixture()
    const a = await fuzz({
      target: '__inline__',
      seed: 42,
      steps: 30,
      pResize: 0.0,
      cwd: TMP_DIR,
      _fixtureDef: fixture,
    } as Parameters<typeof fuzz>[0])
    const b = await fuzz({
      target: '__inline__',
      seed: 42,
      steps: 30,
      pResize: 0.0,
      cwd: TMP_DIR,
      _fixtureDef: fixture,
    } as Parameters<typeof fuzz>[0])
    expect(a.ok).toBe(b.ok)
    if (!a.ok && !b.ok) {
      expect(a.failure?.invariant).toBe(b.failure?.invariant)
      expect(a.failure?.shrunk).toEqual(b.failure?.shrunk)
      expect(a.failure?.sequence).toEqual(b.failure?.sequence)
    }
  })
})

// ---------------------------------------------------------------------------
// 2. Crafted bug — byte 'q' triggers violation; shrunk repro has length 1
// ---------------------------------------------------------------------------
describe('fuzz — finds + shrinks crafted "q crashes" bug', () => {
  it('discovers violation within 50 steps and shrinks to ["q"]', async () => {
    const fixturePath = writeQuitFixture()

    const result = await fuzz({
      target: fixturePath,
      // Seed chosen so the bounded charset hits 'q' inside the first 50
      // draws — any seed should eventually trigger this, but pinning gives
      // us a deterministic test run.
      seed: 1,
      steps: 50,
      pResize: 0.0, // viewport changes irrelevant for this bug
      cwd: TMP_DIR,
    })

    expect(result.ok).toBe(false)
    expect(result.failure).toBeDefined()
    expect(result.failure?.shrunk.length).toBe(1)
    expect(result.failure?.shrunk[0]).toBe('q')
    expect(result.failure?.invariant).toBe('noLossyTruncation')
  }, 30_000)
})
