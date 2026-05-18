// test/core/testing/explorer/sweep/sweep.test.ts
//
// M2.T3 — RED-first tests for the sweep orchestrator.
// 4 cases:
//   1. clean fixture → zero failures, all records pass
//   2. fixture with known mustContain violation → records the failure
//   3. multiple viewport profiles exercised
//   4. failure dump written to .ink-explorer/failures/

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import path from 'path'
import fs from 'fs'
import React from 'react'
import { Text } from 'ink'
import type { FixtureDef, FixtureCase } from '../../../../../src/core/testing/explorer/types'
import { sweep } from '../../../../../src/core/testing/explorer/sweep/sweep'

// ---------------------------------------------------------------------------
// Tmp dir for sweep output (dot-prefix per M1 patch convention)
// ---------------------------------------------------------------------------
const TMP_OUT = path.join(__dirname, '../../../../../.tmp-sweep-test')

function cleanTmp() {
  fs.rmSync(TMP_OUT, { recursive: true, force: true })
}

beforeAll(() => {
  fs.mkdirSync(TMP_OUT, { recursive: true })
})

afterAll(() => {
  cleanTmp()
})

// ---------------------------------------------------------------------------
// Inline fixture helpers (avoid dynamic import of .tsx at test layer)
// ---------------------------------------------------------------------------
const cleanFixture: FixtureDef = {
  component: 'CleanComponent',
  cases: {
    normal: {
      render: () => React.createElement(Text, null, 'hello world'),
    } as FixtureCase,
  },
  viewports: [{ cols: 80, rows: 24 }],
}

// A fixture whose case declares mustContain that won't be in the rendered output
const violatingFixture: FixtureDef = {
  component: 'ViolatingComponent',
  cases: {
    missing: {
      render: () => React.createElement(Text, null, 'hello world'),
      mustContain: ['this-text-is-definitely-missing-from-output'],
    } as FixtureCase,
  },
  viewports: [{ cols: 80, rows: 24 }],
}

// ---------------------------------------------------------------------------
// 1. Clean fixture → zero failures
// ---------------------------------------------------------------------------
describe('sweep — clean fixture', () => {
  it('produces zero failures when all invariants pass', async () => {
    const result = await sweep({
      fixturesGlob: '',  // no file glob; use _fixtures
      cwd: TMP_OUT,
      out: TMP_OUT,
      _fixtures: [{ path: '/test/clean.fixtures.tsx', fixture: cleanFixture }],
    })
    expect(result.failed).toBe(0)
    expect(result.records).toHaveLength(0)
    expect(result.totalRuns).toBeGreaterThan(0)
    expect(result.passed).toBe(result.totalRuns)
  })
})

// ---------------------------------------------------------------------------
// 2. Violating fixture → failure recorded
// ---------------------------------------------------------------------------
describe('sweep — violation detection', () => {
  it('records a failure when mustContain invariant fires', async () => {
    const result = await sweep({
      fixturesGlob: '',
      cwd: TMP_OUT,
      out: TMP_OUT,
      _fixtures: [{ path: '/test/violating.fixtures.tsx', fixture: violatingFixture }],
    })
    expect(result.failed).toBeGreaterThan(0)
    expect(result.records.length).toBeGreaterThan(0)
    expect(result.records[0]?.violations.length).toBeGreaterThan(0)
    expect(result.records[0]?.violations[0]?.rule).toBe('noLossyTruncation')
  })
})

// ---------------------------------------------------------------------------
// 3. Multiple viewport profiles exercised
// ---------------------------------------------------------------------------
describe('sweep — multiple viewports', () => {
  it('runs each case × each viewport (totalRuns = cases × viewports)', async () => {
    const multiViewportFixture: FixtureDef = {
      component: 'Multi',
      cases: {
        caseA: {
          render: () => React.createElement(Text, null, 'aaa'),
        } as FixtureCase,
        caseB: {
          render: () => React.createElement(Text, null, 'bbb'),
        } as FixtureCase,
      },
      viewports: [
        { cols: 60, rows: 20 },
        { cols: 100, rows: 30 },
        { cols: 140, rows: 50 },
      ],
    }
    const result = await sweep({
      fixturesGlob: '',
      cwd: TMP_OUT,
      out: TMP_OUT,
      _fixtures: [{ path: '/test/multi.fixtures.tsx', fixture: multiViewportFixture }],
    })
    // 2 cases × 3 viewports = 6 total runs
    expect(result.totalRuns).toBe(6)
    expect(result.failed).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 4. Failure dump written to .ink-explorer/failures/
// ---------------------------------------------------------------------------
describe('sweep — failure dump written', () => {
  it('writes a .md failure dump to failures/ directory', async () => {
    const failuresDir = path.join(TMP_OUT, '.ink-explorer', 'failures')
    // Clean before test
    fs.rmSync(failuresDir, { recursive: true, force: true })

    const result = await sweep({
      fixturesGlob: '',
      cwd: TMP_OUT,
      out: path.join(TMP_OUT, '.ink-explorer'),
      _fixtures: [{ path: '/test/violating.fixtures.tsx', fixture: violatingFixture }],
    })

    expect(result.failed).toBeGreaterThan(0)
    expect(fs.existsSync(failuresDir)).toBe(true)
    const dumpFiles = fs.readdirSync(failuresDir).filter(f => f.endsWith('.md'))
    expect(dumpFiles.length).toBeGreaterThan(0)
    // Dump should be parseable and contain component name
    const content = fs.readFileSync(path.join(failuresDir, dumpFiles[0]!), 'utf8')
    expect(content).toContain('ViolatingComponent')
    expect(content).toContain('noLossyTruncation')
  })
})
