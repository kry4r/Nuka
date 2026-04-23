import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import { GrepTool } from '../../../src/core/tools/grep'

const ctx = { signal: new AbortController().signal, cwd: '/' }

describe('GrepTool', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(os.tmpdir(), 'nuka-grep-'))
    writeFileSync(join(dir, 'a.ts'), 'export function foo() {}\nexport const bar = 1\n')
    writeFileSync(join(dir, 'b.ts'), 'const baz = 2\n')
  })

  it('finds literal matches with default files_with_matches output', async () => {
    const r = await GrepTool.run({ pattern: 'foo', path: dir }, ctx)
    expect(r.isError).toBe(false)
    expect(r.output).toContain('a.ts')
    expect(r.output).not.toContain('b.ts')
  })

  it('supports output_mode="content"', async () => {
    const r = await GrepTool.run(
      { pattern: 'bar', path: dir, output_mode: 'content' },
      ctx,
    )
    expect(r.isError).toBe(false)
    expect(r.output).toMatch(/bar\s*=\s*1/)
  })
})
