// test/core/diff/applyDiffTool.test.ts
//
// ApplyDiff tool — agent-facing surface that wraps `applyUnifiedDiff` with
// filesystem I/O. These tests cover the contract advertised by the Tool:
// single/multi-file modify, dry-run preview, expectedFiles allow-list,
// add/delete via /dev/null markers, malformed-diff rejection, hunk-mismatch
// non-mutation, and AbortSignal mid-loop.
//
// Tests build their own diff text via formatUnifiedDiff (no external git
// dependency) and run inside a fresh tmpdir per test (no global filesystem
// mutation).

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { formatUnifiedDiff } from '../../../src/core/diff/format'
import {
  APPLY_DIFF_TOOL_NAME,
  ApplyDiffTool,
  applyDiffToFiles,
} from '../../../src/core/diff/applyDiffTool'

const BEFORE = ['one', 'two', 'three', 'four', 'five'].join('\n') + '\n'
const AFTER = ['one', 'TWO', 'three', 'four', 'FIVE'].join('\n') + '\n'

async function makeTmp(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'nuka-applydiff-'))
}

function ctx(opts: { signal?: AbortSignal; cwd: string }): {
  signal: AbortSignal
  cwd: string
} {
  return {
    signal: opts.signal ?? new AbortController().signal,
    cwd: opts.cwd,
  }
}

describe('ApplyDiffTool — schema + metadata', () => {
  it('exposes the upstream-equivalent name and is fs.write-tagged', () => {
    expect(ApplyDiffTool.name).toBe(APPLY_DIFF_TOOL_NAME)
    expect(APPLY_DIFF_TOOL_NAME).toBe('ApplyDiff')
    expect(ApplyDiffTool.tags).toContain('core')
    expect(ApplyDiffTool.tags).toContain('fs.write')
  })

  it('asks for "write" permission for real runs and "none" for dry runs', () => {
    expect(ApplyDiffTool.needsPermission({ diff: 'x', dryRun: false })).toBe(
      'write',
    )
    expect(ApplyDiffTool.needsPermission({ diff: 'x', dryRun: true })).toBe(
      'none',
    )
  })

  it('declares `diff` required and accepts the documented optional fields', () => {
    const params = ApplyDiffTool.parameters as {
      required?: string[]
      properties?: Record<string, { type: string }>
    }
    expect(params.required).toEqual(['diff'])
    expect(params.properties?.diff?.type).toBe('string')
    expect(params.properties?.cwd?.type).toBe('string')
    expect(params.properties?.dryRun?.type).toBe('boolean')
    expect(params.properties?.expectedFiles?.type).toBe('array')
  })

  it('is marked non-parallel-safe (filesystem-mutating)', () => {
    expect(ApplyDiffTool.annotations?.readOnly).toBe(false)
    expect(ApplyDiffTool.annotations?.parallelSafe).toBe(false)
  })
})

describe('ApplyDiffTool — single-file modify', () => {
  let dir: string
  beforeEach(async () => {
    dir = await makeTmp()
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('applies a clean modify and writes the new contents to disk', async () => {
    const file = join(dir, 'r.txt')
    await writeFile(file, BEFORE, 'utf8')
    const diff = formatUnifiedDiff(BEFORE, AFTER, { filename: 'r.txt' })

    const res = await ApplyDiffTool.run({ diff, cwd: dir }, ctx({ cwd: dir }))
    expect(res.isError).toBe(false)

    const written = await readFile(file, 'utf8')
    expect(written).toBe(AFTER)
  })

  it('returns a summary line that names the file and operation', async () => {
    const file = join(dir, 'r.txt')
    await writeFile(file, BEFORE, 'utf8')
    const diff = formatUnifiedDiff(BEFORE, AFTER, { filename: 'r.txt' })

    const res = await ApplyDiffTool.run({ diff, cwd: dir }, ctx({ cwd: dir }))
    expect(typeof res.output).toBe('string')
    expect(res.output as string).toMatch(/applied=1/)
    expect(res.output as string).toMatch(/\+ modify r\.txt/)
  })
})

describe('ApplyDiffTool — multi-file modify', () => {
  let dir: string
  beforeEach(async () => {
    dir = await makeTmp()
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('applies all files in a bundled diff', async () => {
    const a = join(dir, 'a.txt')
    const b = join(dir, 'b.txt')
    await writeFile(a, BEFORE, 'utf8')
    await writeFile(b, 'alpha\nbeta\n', 'utf8')

    const diffA = formatUnifiedDiff(BEFORE, AFTER, { filename: 'a.txt' })
    const diffB = formatUnifiedDiff('alpha\nbeta\n', 'alpha\nBETA\n', {
      filename: 'b.txt',
    })
    const combined = diffA + diffB

    const res = await applyDiffToFiles({ diff: combined, cwd: dir })
    expect(res.failed).toEqual([])
    expect(res.applied).toHaveLength(2)
    expect(await readFile(a, 'utf8')).toBe(AFTER)
    expect(await readFile(b, 'utf8')).toBe('alpha\nBETA\n')
  })
})

describe('ApplyDiffTool — dryRun', () => {
  let dir: string
  beforeEach(async () => {
    dir = await makeTmp()
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('does not write to disk and returns a preview of new contents', async () => {
    const file = join(dir, 'r.txt')
    await writeFile(file, BEFORE, 'utf8')
    const diff = formatUnifiedDiff(BEFORE, AFTER, { filename: 'r.txt' })

    const res = await applyDiffToFiles({ diff, cwd: dir, dryRun: true })
    expect(res.dryRun).toBe(true)
    expect(res.applied).toHaveLength(1)
    expect(res.applied[0]?.preview).toBe(AFTER)

    // File on disk untouched.
    expect(await readFile(file, 'utf8')).toBe(BEFORE)
  })
})

describe('ApplyDiffTool — expectedFiles allow-list', () => {
  let dir: string
  beforeEach(async () => {
    dir = await makeTmp()
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('refuses to write when the diff touches a file outside the allow-list', async () => {
    const a = join(dir, 'a.txt')
    const b = join(dir, 'b.txt')
    await writeFile(a, BEFORE, 'utf8')
    await writeFile(b, 'alpha\nbeta\n', 'utf8')

    const diffA = formatUnifiedDiff(BEFORE, AFTER, { filename: 'a.txt' })
    const diffB = formatUnifiedDiff('alpha\nbeta\n', 'alpha\nBETA\n', {
      filename: 'b.txt',
    })
    const combined = diffA + diffB

    const res = await applyDiffToFiles({
      diff: combined,
      cwd: dir,
      expectedFiles: ['a.txt'], // b.txt is NOT in the list
    })
    expect(res.applied).toEqual([])
    expect(res.failed.length).toBeGreaterThan(0)
    expect(res.failed.some(f => /allow-list/.test(f.reason))).toBe(true)

    // Neither file should have been modified, even the one in the allow-list.
    expect(await readFile(a, 'utf8')).toBe(BEFORE)
    expect(await readFile(b, 'utf8')).toBe('alpha\nbeta\n')
  })

  it('proceeds when every touched file is in the allow-list', async () => {
    const a = join(dir, 'a.txt')
    await writeFile(a, BEFORE, 'utf8')
    const diff = formatUnifiedDiff(BEFORE, AFTER, { filename: 'a.txt' })
    const res = await applyDiffToFiles({
      diff,
      cwd: dir,
      expectedFiles: ['a.txt'],
    })
    expect(res.failed).toEqual([])
    expect(res.applied).toHaveLength(1)
  })
})

describe('ApplyDiffTool — create from /dev/null', () => {
  let dir: string
  beforeEach(async () => {
    dir = await makeTmp()
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('creates a new file from a /dev/null source', async () => {
    const newFile = 'fresh.txt'
    const diff =
      `--- /dev/null\n+++ b/${newFile}\n@@ -0,0 +1,3 @@\n+alpha\n+beta\n+gamma\n`

    const res = await applyDiffToFiles({ diff, cwd: dir })
    expect(res.failed).toEqual([])
    expect(res.applied).toHaveLength(1)
    expect(res.applied[0]?.operation).toBe('create')

    const written = await readFile(join(dir, newFile), 'utf8')
    expect(written).toBe('alpha\nbeta\ngamma\n')
  })

  it('rejects creating a file that already exists with content', async () => {
    const existing = join(dir, 'exists.txt')
    await writeFile(existing, 'pre-existing\n', 'utf8')
    const diff =
      `--- /dev/null\n+++ b/exists.txt\n@@ -0,0 +1,1 @@\n+new\n`
    const res = await applyDiffToFiles({ diff, cwd: dir })
    expect(res.applied).toEqual([])
    expect(res.failed).toHaveLength(1)
    expect(res.failed[0]?.reason).toMatch(/already exists/)
    // Existing file untouched.
    expect(await readFile(existing, 'utf8')).toBe('pre-existing\n')
  })
})

describe('ApplyDiffTool — delete to /dev/null', () => {
  let dir: string
  beforeEach(async () => {
    dir = await makeTmp()
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('removes a file when the destination is /dev/null', async () => {
    const target = join(dir, 'goodbye.txt')
    const contents = 'line1\nline2\n'
    await writeFile(target, contents, 'utf8')

    const diff =
      `--- a/goodbye.txt\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-line1\n-line2\n`

    const res = await applyDiffToFiles({ diff, cwd: dir })
    expect(res.failed).toEqual([])
    expect(res.applied).toHaveLength(1)
    expect(res.applied[0]?.operation).toBe('delete')

    await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses to delete when current content does not match the diff', async () => {
    const target = join(dir, 'goodbye.txt')
    await writeFile(target, 'something else\n', 'utf8')
    const diff =
      `--- a/goodbye.txt\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-line1\n-line2\n`

    const res = await applyDiffToFiles({ diff, cwd: dir })
    expect(res.applied).toEqual([])
    expect(res.failed).toHaveLength(1)
    expect(res.failed[0]?.reason).toMatch(/does not match/)
    // File still on disk.
    expect(await readFile(target, 'utf8')).toBe('something else\n')
  })

  it('does not delete on dryRun', async () => {
    const target = join(dir, 'goodbye.txt')
    await writeFile(target, 'line1\nline2\n', 'utf8')
    const diff =
      `--- a/goodbye.txt\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-line1\n-line2\n`

    const res = await applyDiffToFiles({ diff, cwd: dir, dryRun: true })
    expect(res.failed).toEqual([])
    expect(res.applied[0]?.operation).toBe('delete')
    // Still there.
    await expect(stat(target)).resolves.toBeDefined()
  })
})

describe('ApplyDiffTool — failure modes', () => {
  let dir: string
  beforeEach(async () => {
    dir = await makeTmp()
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('reports an error for an unparseable diff and writes nothing', async () => {
    const res = await applyDiffToFiles({
      diff: 'this is not a diff at all',
      cwd: dir,
    })
    expect(res.applied).toEqual([])
    expect(res.failed).toHaveLength(1)
    expect(res.failed[0]?.reason).toMatch(/empty|unparse/)
  })

  it('reports a hunk-mismatch error and leaves the file untouched', async () => {
    const file = join(dir, 'r.txt')
    await writeFile(file, 'completely\nunrelated\ncontent\n', 'utf8')
    const diff = formatUnifiedDiff(BEFORE, AFTER, { filename: 'r.txt' })

    const res = await applyDiffToFiles({ diff, cwd: dir })
    expect(res.applied).toEqual([])
    expect(res.failed).toHaveLength(1)
    // File on disk is unmodified.
    expect(await readFile(file, 'utf8')).toBe('completely\nunrelated\ncontent\n')
  })

  it('the Tool wrapper returns isError=true when nothing applied', async () => {
    const res = await ApplyDiffTool.run(
      { diff: 'garbage text', cwd: dir },
      ctx({ cwd: dir }),
    )
    expect(res.isError).toBe(true)
  })

  it('the Tool wrapper rejects an empty diff input early', async () => {
    const res = await ApplyDiffTool.run({ diff: '' }, ctx({ cwd: dir }))
    expect(res.isError).toBe(true)
    expect(res.output as string).toMatch(/non-empty/)
  })
})

describe('ApplyDiffTool — AbortSignal', () => {
  let dir: string
  beforeEach(async () => {
    dir = await makeTmp()
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('stops mid-loop and reports aborted=true; later files are not written', async () => {
    // 3 files; we'll abort the controller before invoking, so the first
    // iteration's signal check trips and the loop exits with no writes.
    const ac = new AbortController()
    const a = join(dir, 'a.txt')
    const b = join(dir, 'b.txt')
    const c = join(dir, 'c.txt')
    await writeFile(a, BEFORE, 'utf8')
    await writeFile(b, BEFORE, 'utf8')
    await writeFile(c, BEFORE, 'utf8')
    const combined =
      formatUnifiedDiff(BEFORE, AFTER, { filename: 'a.txt' }) +
      formatUnifiedDiff(BEFORE, AFTER, { filename: 'b.txt' }) +
      formatUnifiedDiff(BEFORE, AFTER, { filename: 'c.txt' })

    ac.abort()
    const res = await applyDiffToFiles({ diff: combined, cwd: dir }, ac.signal)
    expect(res.aborted).toBe(true)
    expect(res.applied).toEqual([])
    // All three files unchanged.
    expect(await readFile(a, 'utf8')).toBe(BEFORE)
    expect(await readFile(b, 'utf8')).toBe(BEFORE)
    expect(await readFile(c, 'utf8')).toBe(BEFORE)
  })
})
