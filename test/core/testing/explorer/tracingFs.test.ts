// test/core/testing/explorer/tracingFs.test.ts
//
// M0.T4 — test ensureExplorerDir and writeFailureDump.
//
// All I/O goes under a tmp directory so the test is hermetic; no
// .ink-explorer/ directory is created in the repo root.

import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

let tmpRoot: string
try {
  tmpRoot = mkdtempSync(path.join(tmpdir(), 'nuka-tracingFs-test-'))
} catch {
  tmpRoot = ''
}

afterAll(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true })
})

describe('ensureExplorerDir', () => {
  it('creates all 5 subdirectories on first call', async () => {
    const { ensureExplorerDir } = await import(
      '../../../../src/core/testing/explorer/common/tracingFs'
    )
    const paths = ensureExplorerDir(tmpRoot)
    expect(existsSync(paths.failures)).toBe(true)
    expect(existsSync(paths.resolved)).toBe(true)
    expect(existsSync(paths.captures)).toBe(true)
    expect(existsSync(paths.judgeCache)).toBe(true)
    expect(existsSync(paths.runs)).toBe(true)
  })

  it('is idempotent (second call does not throw)', async () => {
    const { ensureExplorerDir } = await import(
      '../../../../src/core/testing/explorer/common/tracingFs'
    )
    expect(() => ensureExplorerDir(tmpRoot)).not.toThrow()
  })
})

describe('writeFailureDump', () => {
  it('round-trips a FailureRecord to disk and back', async () => {
    const { ensureExplorerDir, writeFailureDump } = await import(
      '../../../../src/core/testing/explorer/common/tracingFs'
    )
    const paths = ensureExplorerDir(tmpRoot)

    const record = {
      id: 'test-001',
      component: 'Welcome',
      fixtureCase: 'cold',
      viewport: { cols: 80, rows: 24 },
      violations: [
        {
          rule: 'noContentBeyondColumns',
          severity: 'error' as const,
          message: 'content overflows at col 81',
        },
      ],
      asciiView: 'hello world',
      timestamp: new Date().toISOString(),
    }

    const filePath = writeFailureDump(paths, record)

    // File must exist
    expect(existsSync(filePath)).toBe(true)

    // Content must include key fields (round-trip check)
    const content = readFileSync(filePath, 'utf8')
    expect(content).toContain('test-001')
    expect(content).toContain('Welcome')
    expect(content).toContain('noContentBeyondColumns')
  })
})
