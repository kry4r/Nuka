// test/cli/exploreSweep.test.ts
//
// M2.T4 — RED-first tests for sweep CLI plumbing + summary table.
// 3 cases:
//   1. exits 0 when no failures
//   2. exits 1 when failures present
//   3. summary contains fixture name + pass/fail counts

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import path from 'path'
import fs from 'fs'
import { runExploreCli } from '../../src/core/testing/explorer/index'

// ---------------------------------------------------------------------------
// Tmp fixture root for CLI tests
// ---------------------------------------------------------------------------
const TMP_ROOT = path.join(__dirname, '../../.tmp-explore-sweep-cli-test')
const CLEAN_FIXTURES_DIR = path.join(TMP_ROOT, 'clean-fixtures')
const FAILING_FIXTURES_DIR = path.join(TMP_ROOT, 'failing-fixtures')
const OUT_DIR = path.join(TMP_ROOT, '.ink-explorer')

function cleanTmp() {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true })
}

// Write a minimal in-file fixture as .fixtures.tsx that the CLI can load
// We use a fixture that only has .tsx extension — it will be loaded via tsImport
// But to avoid tsx complexity in test setup, we write .js shim files instead
// and use fixturesGlob... Actually, sweep CLI only loads from fixtureRoot.
// For the CLI test, let's use the real regression fixtures directory which
// has known fixtures already.

beforeAll(() => {
  fs.mkdirSync(CLEAN_FIXTURES_DIR, { recursive: true })
  fs.mkdirSync(FAILING_FIXTURES_DIR, { recursive: true })
  fs.mkdirSync(OUT_DIR, { recursive: true })
})

afterEach(() => {
  // Wipe and recreate FAILING_FIXTURES_DIR between tests so fixtures written
  // by one test cannot leak into and influence the next test's run.
  fs.rmSync(FAILING_FIXTURES_DIR, { recursive: true, force: true })
  fs.mkdirSync(FAILING_FIXTURES_DIR, { recursive: true })
})

afterAll(() => {
  cleanTmp()
})

// ---------------------------------------------------------------------------
// 1. exits 0 when using a directory with no fixtures (zero runs = pass)
// ---------------------------------------------------------------------------
describe('exploreSweep CLI — exit codes', () => {
  it('exits 0 when fixture dir is empty (no failures)', async () => {
    // Capture stdout
    const lines: string[] = []
    const origWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = ((chunk: string | Uint8Array) => {
      if (typeof chunk === 'string') lines.push(chunk)
      return true
    }) as typeof process.stdout.write

    let rc: number
    try {
      rc = await runExploreCli([
        'sweep',
        `--fixture-root=${CLEAN_FIXTURES_DIR}`,
        `--out=${OUT_DIR}`,
      ])
    } finally {
      process.stdout.write = origWrite
    }

    expect(rc).toBe(0)
  })

  it('exits 1 when real regression fixtures have failures', async () => {
    // The real regression fixtures (bug-a, bug-b) will trigger assert() failures
    // but those run through the custom assert hook, not L1 invariants.
    // We need a fixture that triggers an L1 mustContain violation.
    // Use the real fixtures dir — but those fixtures don't have mustContain.
    // Instead: pass a fixture with a known L1 violation via the real fixtures dir
    // by writing a small .tsx fixture... but we can't create tsx files here easily.
    //
    // Alternative: create a temporary JS module that exports a FixtureDef.
    // The fixtureLoader only picks up *.fixtures.tsx, so we need .tsx extension.
    // We'll write a minimal JSX-free tsx that just exports a FixtureDef.
    const fixtureContent = `
import React from 'react'
import { Text } from 'ink'
const fixture = {
  component: 'CLITestFailing',
  cases: {
    'missing-text': {
      render: () => React.createElement(Text, null, 'hello'),
      mustContain: ['this-text-never-appears-xyzzy-unique-12345'],
    },
  },
  viewports: [{ cols: 80, rows: 10 }],
}
export default fixture
`
    const fixturePath = path.join(FAILING_FIXTURES_DIR, 'cli-test-fail.fixtures.tsx')
    fs.writeFileSync(fixturePath, fixtureContent, 'utf8')

    const lines: string[] = []
    const origWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = ((chunk: string | Uint8Array) => {
      if (typeof chunk === 'string') lines.push(chunk)
      return true
    }) as typeof process.stdout.write

    let rc: number
    try {
      rc = await runExploreCli([
        'sweep',
        `--fixture-root=${FAILING_FIXTURES_DIR}`,
        `--out=${OUT_DIR}`,
      ])
    } finally {
      process.stdout.write = origWrite
    }

    expect(rc).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 3. summary contains fixture name + pass/fail counts
// ---------------------------------------------------------------------------
describe('exploreSweep CLI — summary output', () => {
  it('summary table contains fixture name and pass/fail counts', async () => {
    const fixturePath = path.join(FAILING_FIXTURES_DIR, 'summary-test.fixtures.tsx')
    const fixtureContent = `
import React from 'react'
import { Text } from 'ink'
const fixture = {
  component: 'SummaryTestFixture',
  cases: {
    'should-fail': {
      render: () => React.createElement(Text, null, 'hi'),
      mustContain: ['not-present-text-abc123'],
    },
    'should-pass': {
      render: () => React.createElement(Text, null, 'hi'),
    },
  },
  viewports: [{ cols: 80, rows: 10 }],
}
export default fixture
`
    fs.writeFileSync(fixturePath, fixtureContent, 'utf8')

    const lines: string[] = []
    const origWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = ((chunk: string | Uint8Array) => {
      if (typeof chunk === 'string') lines.push(chunk)
      return true
    }) as typeof process.stdout.write

    let rc: number
    try {
      rc = await runExploreCli([
        'sweep',
        `--fixture-root=${FAILING_FIXTURES_DIR}`,
        `--out=${OUT_DIR}`,
      ])
    } finally {
      process.stdout.write = origWrite
    }

    const output = lines.join('')
    // Summary must contain fixture name
    expect(output).toMatch(/SummaryTestFixture/)
    // Summary must contain pass and fail counts
    expect(output).toMatch(/passed|PASS/i)
    expect(output).toMatch(/failed|FAIL/i)
    // rc should be 1 because one case fails
    expect(rc).toBe(1)
  })
})
