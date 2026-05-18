// test/core/testing/explorer/L4_repair/dumpReader.test.ts
//
// M5.T1 — RED-first tests for the FailureRecord dump round-trip.
// See locked spec §6 (dump format) + §4.6 step 1 (`dumpReader.ts`).
//
// The reader must be the exact inverse of `writeFailureDump`: every field
// enumerated on `FailureRecord` (types.ts) must survive the write→read
// round-trip lossless. The M4 reviewer note flagged that the writer was
// dropping `gridHash`; M5.T1 fixes the writer AND adds the reader.

import { describe, it, expect, afterAll, afterEach } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  existsSync,
  writeFileSync,
  readFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FailureRecord } from '../../../../../src/core/testing/explorer/types'

let tmpRoot = ''
const tmpRoots: string[] = []

function mkTmp(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'nuka-dumpreader-test-'))
  tmpRoots.push(dir)
  return dir
}

afterEach(() => {
  // Per-test cleanup: remove all tmp dirs created so far.
  // Keeps test isolation tight: a failure in one test doesn't leave
  // artefacts that interfere with subsequent tests.
  for (const dir of tmpRoots.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
})

afterAll(() => {
  // Final sweep: clean up any dirs that survived afterEach (e.g. if test
  // was aborted before afterEach ran). Memory rule: both hooks active.
  for (const dir of tmpRoots) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
})

function makeSample(overrides: Partial<FailureRecord> = {}): FailureRecord {
  return {
    id: 'roundtrip-001',
    component: 'Welcome',
    fixtureCase: 'cold',
    viewport: { cols: 80, rows: 24 },
    violations: [
      {
        rule: 'noContentBeyondColumns',
        severity: 'error',
        message: 'content overflows at col 81',
        excerpt: 'overflowing line >>>',
        cells: [
          { x: 81, y: 5 },
          { x: 82, y: 5 },
        ],
      },
      {
        rule: 'flexGrowBounded',
        severity: 'warn',
        message: 'flex grew past hug',
      },
    ],
    asciiView: 'hello\nworld\n',
    gridHash: 'a1b2c3d4e5f6',
    // Fix 5 (M6.P0): fixturePath must be present so the round-trip test
    // is non-vacuous — the writer emits it, the reader must restore it.
    fixturePath: '/abs/path/foo.fixtures.tsx',
    stdinSequence: ['q', 'ctrl-c'],
    timestamp: '2026-05-18T12:34:56.000Z',
    ...overrides,
  }
}

describe('L4_repair/dumpReader — readDump', () => {
  it('writeFailureDump → readDump round-trip is lossless on every field', async () => {
    tmpRoot = mkTmp()
    const { ensureExplorerDir, writeFailureDump } = await import(
      '../../../../../src/core/testing/explorer/common/tracingFs'
    )
    const { readDump } = await import(
      '../../../../../src/core/testing/explorer/L4_repair/dumpReader'
    )

    const paths = ensureExplorerDir(tmpRoot)
    const original = makeSample()
    const filePath = writeFailureDump(paths, original)

    expect(existsSync(filePath)).toBe(true)
    const recovered = readDump(filePath)
    // Every field on FailureRecord must round-trip exactly.
    expect(recovered).toEqual(original)
  })

  it('round-trips gridHash specifically (M4 reviewer note follow-up)', async () => {
    tmpRoot = mkTmp()
    const { ensureExplorerDir, writeFailureDump } = await import(
      '../../../../../src/core/testing/explorer/common/tracingFs'
    )
    const { readDump } = await import(
      '../../../../../src/core/testing/explorer/L4_repair/dumpReader'
    )

    const paths = ensureExplorerDir(tmpRoot)
    const original = makeSample({ gridHash: 'deadbeef-cafe-1234' })
    const filePath = writeFailureDump(paths, original)
    const text = readFileSync(filePath, 'utf8')
    // Writer MUST emit gridHash now.
    expect(text).toContain('deadbeef-cafe-1234')
    // Reader MUST parse it back.
    expect(readDump(filePath).gridHash).toBe('deadbeef-cafe-1234')
  })

  it('round-trips when stdinSequence and gridHash are omitted (optional fields)', async () => {
    tmpRoot = mkTmp()
    const { ensureExplorerDir, writeFailureDump } = await import(
      '../../../../../src/core/testing/explorer/common/tracingFs'
    )
    const { readDump } = await import(
      '../../../../../src/core/testing/explorer/L4_repair/dumpReader'
    )

    const paths = ensureExplorerDir(tmpRoot)
    const original: FailureRecord = {
      id: 'minimal-001',
      component: 'StatusPanel',
      fixtureCase: 'default',
      viewport: { cols: 60, rows: 20 },
      violations: [],
      asciiView: 'status\n',
      timestamp: '2026-05-18T00:00:00.000Z',
    }
    const filePath = writeFailureDump(paths, original)
    const recovered = readDump(filePath)
    expect(recovered.id).toBe(original.id)
    expect(recovered.component).toBe(original.component)
    expect(recovered.viewport).toEqual(original.viewport)
    expect(recovered.violations).toEqual([])
    expect(recovered.stdinSequence).toBeUndefined()
    expect(recovered.gridHash).toBeUndefined()
  })

  it('throws if the dump file is missing', async () => {
    tmpRoot = mkTmp()
    const { readDump } = await import(
      '../../../../../src/core/testing/explorer/L4_repair/dumpReader'
    )
    const missing = path.join(tmpRoot, 'does-not-exist.md')
    expect(() => readDump(missing)).toThrow()
  })

  it('throws on malformed dump (no header / missing required fields)', async () => {
    tmpRoot = mkTmp()
    const { readDump } = await import(
      '../../../../../src/core/testing/explorer/L4_repair/dumpReader'
    )
    const badPath = path.join(tmpRoot, 'bad.md')
    writeFileSync(badPath, '# not a real failure dump\n', 'utf8')
    expect(() => readDump(badPath)).toThrow(/dump|parse|missing/i)
  })
})
