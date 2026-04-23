// test/core/tools/write.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import { WriteTool } from '../../../src/core/tools/write'

function tmp(): string { return mkdtempSync(join(os.tmpdir(), 'nuka-write-')) }
const ctx = { signal: new AbortController().signal, cwd: '/' }

describe('WriteTool', () => {
  let dir: string
  beforeEach(() => { dir = tmp() })

  it('creates a new file and declares write permission', () => {
    expect(WriteTool.needsPermission({ path: '/tmp/x', content: 'a' })).toBe('write')
  })

  it('writes content atomically', async () => {
    const p = join(dir, 'a.txt')
    const r = await WriteTool.run({ path: p, content: 'hi\n' }, ctx)
    expect(r.isError).toBe(false)
    expect(existsSync(p)).toBe(true)
    expect(readFileSync(p, 'utf8')).toBe('hi\n')
  })

  it('errors if parent directory does not exist', async () => {
    const p = join(dir, 'does-not-exist', 'a.txt')
    const r = await WriteTool.run({ path: p, content: 'x' }, ctx)
    expect(r.isError).toBe(true)
  })
})
