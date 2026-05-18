// test/core/testing/explorer/fuzz.test.ts
//
// M3.T3 — RED-first tests for the fuzz() orchestrator.
// See locked spec §4.4.
//
// Tests:
//   1. determinism — same seed + same fixture → identical FuzzResult twice
//      (clean path).
//   2. determinism — violation path: same seed + buggy fixture → identical
//      failure twice (proves orchestrator determinism on the violation path).
//   3. crafted fixture: bug fires on byte 'q' → fuzz finds violation within
//      ≤ 200 steps; shrunk repro has length 1 == ['q'].
//   4. disk fixture: loadFixtureFile round-trip via tsImport; simple
//      noContentBeyondColumns fixture.
//
// The crafted fixture is materialised on disk in a dot-prefixed tmp dir
// (./.tmp-fuzz-test/) that lives under .gitignore. afterEach + afterAll
// both call cleanup to satisfy the test-temp-cleanup memory rule.

import { describe, it, expect, afterEach, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import { Text, useInput } from 'ink'
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
// QuitBug — inline crafted component whose `mustContain` marker disappears on
// the byte 'q'. We use an inline _fixtureDef (instead of a disk fixture file)
// so the React + ink modules match the test runtime exactly. Loading .tsx
// fixtures through tsx/esm/api would duplicate the React module instance and
// disconnect ink's renderer from the test's `useState` hook tracking.
// The dot-prefixed TMP_DIR is still ensured/cleaned so the cleanup
// invariants are honoured even for inline-only tests.
// ---------------------------------------------------------------------------
function QuitBug(): React.ReactElement {
  const [broken, setBroken] = React.useState(false)
  useInput((input) => {
    if (input === 'q') setBroken(true)
  })
  // Different-length content so ink emits an in-place rerender FakeStdout
  // can detect via its cursor-positioning heuristic.
  return React.createElement(Text, null, broken ? 'BROKEN-LONG' : 'OK-MARKER')
}

const quitBugFixture: FixtureDef = {
  component: 'QuitBug',
  cases: {
    fuzz: {
      render: () => React.createElement(QuitBug),
      mustContain: ['OK-MARKER'],
    },
  },
  viewports: [{ cols: 40, rows: 10 }],
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
// 1. Determinism — same seed + same fixture → identical result twice (clean)
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

  it('same seed + same fixture → identical FuzzResult on the violation path', async () => {
    // Uses the quitBugFixture + seed=46 (known to trigger the bug) to
    // exercise orchestrator determinism on the failure branch.
    ensureTmp()
    const opts = {
      target: '__inline__',
      seed: 46,
      steps: 200,
      pResize: 0.0,
      cwd: TMP_DIR,
      _fixtureDef: quitBugFixture,
    } as Parameters<typeof fuzz>[0]
    const a = await fuzz(opts)
    const b = await fuzz(opts)
    expect(a.failure).toBeDefined()
    expect(b.failure).toBeDefined()
    expect(a.failure!.sequence).toEqual(b.failure!.sequence)   // byte-for-byte
    expect(a.failure!.shrunk).toEqual(b.failure!.shrunk)
    expect(a.failure!.invariant).toBe(b.failure!.invariant)
  }, 60_000)
})

// ---------------------------------------------------------------------------
// 2. Crafted bug — byte 'q' triggers violation; shrunk repro has length 1
// ---------------------------------------------------------------------------
describe('fuzz — finds + shrinks crafted "q crashes" bug', () => {
  it('discovers violation within 200 steps and shrinks to ["q"]', async () => {
    // Touch the tmp dir so the cleanup invariants are exercised even when
    // no file is written (memory rule feedback_test_temp_cleanup.md).
    ensureTmp()

    const result = await fuzz({
      target: '__inline__',
      // Seed chosen so the bounded charset hits 'q' inside the first 50
      // draws. Empirically scanning seeds 1..200: seed=46 puts 'q' at
      // position 1 (so the shrinker has to drop one neighbour to reach
      // length 1, which exercises the per-step deletion phase).
      seed: 46,
      steps: 200,
      pResize: 0.0, // viewport changes irrelevant for this bug
      cwd: TMP_DIR,
      _fixtureDef: quitBugFixture,
    } as Parameters<typeof fuzz>[0])

    expect(result.ok).toBe(false)
    expect(result.failure).toBeDefined()
    expect(result.failure?.shrunk.length).toBe(1)
    expect(result.failure?.shrunk[0]).toBe('q')
    expect(result.failure?.invariant).toBe('noLossyTruncation')
  }, 30_000)
})

// ---------------------------------------------------------------------------
// 3. Disk fixture — loadFixtureFile round-trip via tsImport.
//
// Writes a minimal .fixtures.mts into TMP_DIR. The fixture renders a plain
// <Text> with a mustContain sentinel that is never satisfied → noLossyTruncation
// fires from frame 0. No hooks (useInput/useState) → avoids React-module-
// duplication. This proves loadFixtureFile round-trips through tsImport.
//
// noContentBeyondColumns was the original target, but ink's yoga-layout wraps
// content at stdout.columns, so a plain overlong Text always wraps rather than
// overflowing — the asciiView is always clipped to cols. noLossyTruncation
// triggers reliably: any mustContain value absent from the rendered output
// fires immediately from frame 0.
//
// If tsImport pulls in a separate React/ink module instance, fuzz() may throw
// (React-module-duplication error). In that case mark it.skip with a comment.
// ---------------------------------------------------------------------------
describe('fuzz — disk fixture (loadFixtureFile round-trip)', () => {
  it('noLossyTruncation fires from frame 0 on a disk fixture with unmet mustContain', async () => {
    // The fixture source: a plain <Text> that never renders 'SENTINEL_NEVER'.
    // No useInput/useState → static render, avoids React-module-duplication.
    const fixtureSource = `
import React from 'react'
import { Text } from 'ink'
import type { FixtureDef } from '../../../src/core/testing/explorer/types'

const fixture: FixtureDef = {
  component: 'MustContainMiss',
  cases: {
    basic: {
      render: () => React.createElement(Text, null, 'hello'),
      // This sentinel will never appear in the rendered output.
      mustContain: ['SENTINEL_NEVER'],
    },
  },
  viewports: [{ cols: 40, rows: 5 }],
}

export default fixture
`
    ensureTmp()
    const fixturePath = path.join(TMP_DIR, 'must-contain-miss.fixtures.mts')
    fs.writeFileSync(fixturePath, fixtureSource, 'utf8')

    const result = await fuzz({
      target: fixturePath,
      seed: 1,
      steps: 5,
      pResize: 0.0,
      cwd: TMP_DIR,
    } as Parameters<typeof fuzz>[0])

    expect(result.ok).toBe(false)
    expect(result.failure).toBeDefined()
    expect(result.failure!.invariant).toBe('noLossyTruncation')
  }, 30_000)
})
