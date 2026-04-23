// test/core/tools/glob.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import { GlobTool } from '../../../src/core/tools/glob'

const ctx = { signal: new AbortController().signal, cwd: '/' }

describe('GlobTool', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(os.tmpdir(), 'nuka-glob-'))
    mkdirSync(join(dir, 'a'))
    writeFileSync(join(dir, 'a', 'x.ts'), '')
    writeFileSync(join(dir, 'a', 'y.md'), '')
    writeFileSync(join(dir, 'top.ts'), '')
  })

  it('matches extension patterns recursively', async () => {
    const r = await GlobTool.run({ pattern: '**/*.ts', path: dir }, ctx)
    expect(r.isError).toBe(false)
    expect(r.output).toContain('top.ts')
    expect(r.output).toContain('x.ts')
    expect(r.output).not.toContain('y.md')
  })

  it('returns empty list when nothing matches', async () => {
    const r = await GlobTool.run({ pattern: '**/*.zzz', path: dir }, ctx)
    expect(r.isError).toBe(false)
    expect(r.output.trim()).toBe('')
  })
})
