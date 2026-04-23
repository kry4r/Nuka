// test/core/tools/edit.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import { EditTool } from '../../../src/core/tools/edit'

function tmp(): string { return mkdtempSync(join(os.tmpdir(), 'nuka-edit-')) }
const ctx = { signal: new AbortController().signal, cwd: '/' }

describe('EditTool', () => {
  let dir: string
  beforeEach(() => { dir = tmp() })

  it('replaces a unique occurrence', async () => {
    const p = join(dir, 'a.ts')
    writeFileSync(p, 'const x = 1\nconst y = 2\n')
    const r = await EditTool.run(
      { path: p, old_string: 'const x = 1', new_string: 'const x = 42' },
      ctx,
    )
    expect(r.isError).toBe(false)
    expect(readFileSync(p, 'utf8')).toBe('const x = 42\nconst y = 2\n')
  })

  it('errors if old_string appears multiple times and replace_all is false', async () => {
    const p = join(dir, 'a.ts')
    writeFileSync(p, 'x\nx\n')
    const r = await EditTool.run(
      { path: p, old_string: 'x', new_string: 'y' },
      ctx,
    )
    expect(r.isError).toBe(true)
  })

  it('replaces all occurrences when replace_all=true', async () => {
    const p = join(dir, 'a.ts')
    writeFileSync(p, 'x\nx\n')
    const r = await EditTool.run(
      { path: p, old_string: 'x', new_string: 'y', replace_all: true },
      ctx,
    )
    expect(r.isError).toBe(false)
    expect(readFileSync(p, 'utf8')).toBe('y\ny\n')
  })

  it('errors if old_string is not found', async () => {
    const p = join(dir, 'a.ts')
    writeFileSync(p, 'hello')
    const r = await EditTool.run(
      { path: p, old_string: 'nope', new_string: 'x' },
      ctx,
    )
    expect(r.isError).toBe(true)
  })
})
