import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import { ReadTool } from '../../../src/core/tools/read'

function tmp(): string { return mkdtempSync(join(os.tmpdir(), 'nuka-read-')) }

describe('ReadTool', () => {
  let dir: string
  beforeEach(() => { dir = tmp() })

  it('reads a file with cat -n style line numbers', async () => {
    const p = join(dir, 'a.txt')
    writeFileSync(p, 'hello\nworld\n')
    const r = await ReadTool.run({ path: p }, { signal: new AbortController().signal, cwd: dir })
    expect(r.isError).toBe(false)
    expect(r.output).toContain('1\thello')
    expect(r.output).toContain('2\tworld')
  })

  it('supports offset + limit', async () => {
    const p = join(dir, 'b.txt')
    writeFileSync(p, 'a\nb\nc\nd\ne\n')
    const r = await ReadTool.run(
      { path: p, offset: 2, limit: 2 },
      { signal: new AbortController().signal, cwd: dir },
    )
    expect(r.output).toContain('2\tb')
    expect(r.output).toContain('3\tc')
    expect(r.output).not.toContain('d')
  })

  it('returns isError for missing file', async () => {
    const r = await ReadTool.run(
      { path: join(dir, 'missing.txt') },
      { signal: new AbortController().signal, cwd: dir },
    )
    expect(r.isError).toBe(true)
  })

  it('rejects binary files by default', async () => {
    const p = join(dir, 'bin')
    writeFileSync(p, Buffer.from([0, 1, 2, 0, 3]))
    const r = await ReadTool.run({ path: p }, { signal: new AbortController().signal, cwd: dir })
    expect(r.isError).toBe(true)
    expect(r.output).toMatch(/binary/i)
  })
})
