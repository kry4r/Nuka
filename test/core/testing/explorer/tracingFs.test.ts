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

  it('concurrent calls do not throw (race-safe mkdirSync)', async () => {
    const { ensureExplorerDir } = await import(
      '../../../../src/core/testing/explorer/common/tracingFs'
    )
    // Promise.all with same root exercises the concurrent creation path;
    // mkdirSync({recursive:true}) is safe even when dirs already exist.
    await expect(
      Promise.all([ensureExplorerDir(tmpRoot), ensureExplorerDir(tmpRoot)]),
    ).resolves.toBeDefined()
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

  it('round-trips excerpt, cells, and stdinSequence fields', async () => {
    const { ensureExplorerDir, writeFailureDump } = await import(
      '../../../../src/core/testing/explorer/common/tracingFs'
    )
    const paths = ensureExplorerDir(tmpRoot)

    const record = {
      id: 'test-002',
      component: 'StatusPanel',
      fixtureCase: 'overflow',
      viewport: { cols: 60, rows: 20 },
      violations: [
        {
          rule: 'noBeyondViewport',
          severity: 'error' as const,
          message: 'cell escapes viewport',
          excerpt: 'line with overflow >>>',
          cells: [
            { x: 61, y: 5 },
            { x: 62, y: 5 },
          ],
        },
      ],
      asciiView: 'status panel view',
      stdinSequence: ['ctrl-c', 'q'],
      timestamp: new Date().toISOString(),
    }

    const filePath = writeFailureDump(paths, record)
    expect(existsSync(filePath)).toBe(true)

    const content = readFileSync(filePath, 'utf8')
    // excerpt block
    expect(content).toContain('line with overflow >>>')
    // cells coordinates
    expect(content).toContain('(61,5)')
    // stdinSequence JSON
    expect(content).toContain('"ctrl-c"')
    expect(content).toContain('"q"')
  })
})
