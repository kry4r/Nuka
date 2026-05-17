// test/core/findReplace/findReplaceTool.test.ts
//
// FindReplace tool — compound tool wrapping walker + glob + diff format
// + applyDiffToFiles into a safe-by-default search-and-replace.
//
// Tests cover the spec'd contract:
//   - schema / metadata (name, tags, permissions, parameters)
//   - input validation (empty pattern, invalid regex, missing
//     expectedFiles for non-dryRun)
//   - dryRun behaviour (no writes; per-file previews)
//   - regex mode (literal vs regex, backreferences, case-insensitive,
//     multiline)
//   - non-dryRun behaviour (expectedFiles guard, refused files, actual
//     disk writes)
//   - maxFiles cap (truncated flag)
//   - gitignore honoured (tmpdir fixture with .gitignore)
//   - excludePaths filter
//   - AbortSignal mid-scan (partial result)
//
// All tests use a fresh tmpdir per test so we don't depend on the host
// repo's contents.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  FIND_REPLACE_DEFAULT_MAX_FILES,
  FIND_REPLACE_HARD_MAX_FILES,
  FIND_REPLACE_TOOL_NAME,
  FindReplaceTool,
  runFindReplace,
  type FindReplaceResult,
} from '../../../src/core/findReplace/findReplaceTool'

async function makeTmp(prefix = 'nuka-findReplace-'): Promise<string> {
  return await mkdtemp(join(tmpdir(), prefix))
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

/** Parse the trailing JSON line out of a Tool string output. */
function parseJsonTail(s: string): FindReplaceResult {
  const lines = s.trim().split('\n')
  const last = lines[lines.length - 1]
  return JSON.parse(last) as FindReplaceResult
}

describe('FindReplaceTool — schema + metadata', () => {
  it('exposes the documented name and tags', () => {
    expect(FindReplaceTool.name).toBe(FIND_REPLACE_TOOL_NAME)
    expect(FIND_REPLACE_TOOL_NAME).toBe('FindReplace')
    expect(FindReplaceTool.tags).toContain('core')
    expect(FindReplaceTool.tags).toContain('fs.read')
    expect(FindReplaceTool.tags).toContain('fs.write')
  })

  it('declares the documented required + optional parameters', () => {
    const params = FindReplaceTool.parameters as {
      required?: string[]
      properties?: Record<string, { type: string }>
    }
    expect(params.required).toEqual(['glob', 'pattern', 'replacement'])
    expect(params.properties?.glob?.type).toBe('string')
    expect(params.properties?.pattern?.type).toBe('string')
    expect(params.properties?.replacement?.type).toBe('string')
    expect(params.properties?.isRegex?.type).toBe('boolean')
    expect(params.properties?.caseInsensitive?.type).toBe('boolean')
    expect(params.properties?.multiline?.type).toBe('boolean')
    expect(params.properties?.dryRun?.type).toBe('boolean')
    expect(params.properties?.expectedFiles?.type).toBe('array')
    expect(params.properties?.maxFiles?.type).toBe('number')
    expect(params.properties?.respectGitignore?.type).toBe('boolean')
    expect(params.properties?.excludePaths?.type).toBe('array')
  })

  it('asks for none permission on dryRun and write on non-dryRun', () => {
    expect(
      FindReplaceTool.needsPermission({
        glob: '**/*.ts',
        pattern: 'a',
        replacement: 'b',
      }),
    ).toBe('none')
    expect(
      FindReplaceTool.needsPermission({
        glob: '**/*.ts',
        pattern: 'a',
        replacement: 'b',
        dryRun: false,
      }),
    ).toBe('write')
  })

  it('is marked non-parallel-safe (filesystem-mutating in worst case)', () => {
    expect(FindReplaceTool.annotations?.readOnly).toBe(false)
    expect(FindReplaceTool.annotations?.parallelSafe).toBe(false)
  })

  it('has the documented default and hard-max file caps', () => {
    expect(FIND_REPLACE_DEFAULT_MAX_FILES).toBe(100)
    expect(FIND_REPLACE_HARD_MAX_FILES).toBe(1000)
  })
})

describe('FindReplaceTool — input validation', () => {
  let dir: string
  beforeEach(async () => {
    dir = await makeTmp()
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('refuses an empty pattern', async () => {
    const res = await FindReplaceTool.run(
      {
        glob: '**/*.ts',
        pattern: '',
        replacement: 'x',
        rootDir: dir,
      },
      ctx({ cwd: dir }),
    )
    expect(res.isError).toBe(true)
    expect(res.output as string).toMatch(/pattern.*non-empty/)
  })

  it('refuses an empty glob', async () => {
    const res = await FindReplaceTool.run(
      {
        glob: '',
        pattern: 'foo',
        replacement: 'bar',
        rootDir: dir,
      },
      ctx({ cwd: dir }),
    )
    expect(res.isError).toBe(true)
    expect(res.output as string).toMatch(/glob.*non-empty/)
  })

  it('refuses non-dryRun without expectedFiles', async () => {
    await writeFile(join(dir, 'a.ts'), 'foo\n')
    const res = await FindReplaceTool.run(
      {
        glob: '**/*.ts',
        pattern: 'foo',
        replacement: 'bar',
        rootDir: dir,
        dryRun: false,
      },
      ctx({ cwd: dir }),
    )
    expect(res.isError).toBe(true)
    expect(res.output as string).toMatch(/expectedFiles/)
  })

  it('refuses non-dryRun with empty expectedFiles array', async () => {
    await writeFile(join(dir, 'a.ts'), 'foo\n')
    const res = await FindReplaceTool.run(
      {
        glob: '**/*.ts',
        pattern: 'foo',
        replacement: 'bar',
        rootDir: dir,
        dryRun: false,
        expectedFiles: [],
      },
      ctx({ cwd: dir }),
    )
    expect(res.isError).toBe(true)
    expect(res.output as string).toMatch(/expectedFiles/)
  })

  it('catches invalid regex and reports a structured error', async () => {
    await writeFile(join(dir, 'a.ts'), 'foo\n')
    const res = await FindReplaceTool.run(
      {
        glob: '**/*.ts',
        pattern: '(unclosed',
        replacement: 'x',
        isRegex: true,
        rootDir: dir,
      },
      ctx({ cwd: dir }),
    )
    expect(res.isError).toBe(true)
    expect(res.output as string).toMatch(/invalid regex/i)
  })
})

describe('FindReplaceTool — dryRun preview', () => {
  let dir: string
  beforeEach(async () => {
    dir = await makeTmp()
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('returns a preview for a single matching file without writing', async () => {
    const file = join(dir, 'r.ts')
    const before = 'const hello = "world"\n'
    await writeFile(file, before, 'utf8')

    const res = await FindReplaceTool.run(
      {
        glob: '**/*.ts',
        pattern: 'hello',
        replacement: 'greeting',
        rootDir: dir,
      },
      ctx({ cwd: dir }),
    )
    expect(res.isError).toBe(false)

    const payload = parseJsonTail(res.output as string)
    expect(payload.dryRun).toBe(true)
    expect(payload.filesScanned).toBe(1)
    expect(payload.filesChanged).toBe(1)
    expect(payload.filesSkipped).toBe(0)
    expect(payload.previews).toHaveLength(1)
    expect(payload.previews[0]!.path).toBe('r.ts')
    expect(payload.previews[0]!.diff).toContain('-const hello')
    expect(payload.previews[0]!.diff).toContain('+const greeting')
    expect(payload.previews[0]!.additions).toBeGreaterThan(0)
    expect(payload.previews[0]!.deletions).toBeGreaterThan(0)

    // No writes happened.
    const after = await readFile(file, 'utf8')
    expect(after).toBe(before)
  })

  it('scans only files matching the glob (skips .js when glob is **/*.ts)', async () => {
    await writeFile(join(dir, 'a.ts'), 'hello\n', 'utf8')
    await writeFile(join(dir, 'b.ts'), 'hello\n', 'utf8')
    await writeFile(join(dir, 'c.js'), 'hello\n', 'utf8')

    const res = await FindReplaceTool.run(
      {
        glob: '**/*.ts',
        pattern: 'hello',
        replacement: 'hi',
        rootDir: dir,
      },
      ctx({ cwd: dir }),
    )
    const payload = parseJsonTail(res.output as string)
    expect(payload.filesChanged).toBe(2)
    expect(payload.previews.map(p => p.path).sort()).toEqual([
      'a.ts',
      'b.ts',
    ])
  })

  it('skips files where the pattern did not match (no diff text)', async () => {
    await writeFile(join(dir, 'match.ts'), 'hello world\n', 'utf8')
    await writeFile(join(dir, 'nomatch.ts'), 'unrelated\n', 'utf8')

    const res = await FindReplaceTool.run(
      {
        glob: '**/*.ts',
        pattern: 'hello',
        replacement: 'hi',
        rootDir: dir,
      },
      ctx({ cwd: dir }),
    )
    const payload = parseJsonTail(res.output as string)
    expect(payload.filesScanned).toBe(2)
    expect(payload.filesChanged).toBe(1)
    expect(payload.filesSkipped).toBe(1)
    expect(payload.previews.map(p => p.path)).toEqual(['match.ts'])
  })
})

describe('FindReplaceTool — regex modes', () => {
  let dir: string
  beforeEach(async () => {
    dir = await makeTmp()
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('supports backreferences in regex mode', async () => {
    const file = join(dir, 'r.ts')
    await writeFile(file, 'foo(bar) baz(qux)\n', 'utf8')

    const res = await FindReplaceTool.run(
      {
        glob: '**/*.ts',
        pattern: '(\\w+)\\((\\w+)\\)',
        replacement: '$2/$1',
        isRegex: true,
        rootDir: dir,
      },
      ctx({ cwd: dir }),
    )
    const payload = parseJsonTail(res.output as string)
    expect(payload.previews).toHaveLength(1)
    expect(payload.previews[0]!.diff).toContain('+bar/foo qux/baz')
  })

  it('caseInsensitive matches both cases', async () => {
    await writeFile(join(dir, 'a.ts'), 'Hello hello HELLO\n', 'utf8')

    const res = await FindReplaceTool.run(
      {
        glob: '**/*.ts',
        pattern: 'hello',
        replacement: 'WORLD',
        caseInsensitive: true,
        rootDir: dir,
      },
      ctx({ cwd: dir }),
    )
    const payload = parseJsonTail(res.output as string)
    expect(payload.previews).toHaveLength(1)
    expect(payload.previews[0]!.diff).toContain('+WORLD WORLD WORLD')
  })

  it('default (no caseInsensitive) preserves case sensitivity', async () => {
    await writeFile(join(dir, 'a.ts'), 'Hello hello HELLO\n', 'utf8')

    const res = await FindReplaceTool.run(
      {
        glob: '**/*.ts',
        pattern: 'hello',
        replacement: 'WORLD',
        rootDir: dir,
      },
      ctx({ cwd: dir }),
    )
    const payload = parseJsonTail(res.output as string)
    expect(payload.previews).toHaveLength(1)
    // Only the lowercase 'hello' should be replaced.
    expect(payload.previews[0]!.diff).toContain('+Hello WORLD HELLO')
  })

  it('multiline regex matches `^` at line starts', async () => {
    const content = 'line one\nline two\nline three\n'
    await writeFile(join(dir, 'a.ts'), content, 'utf8')

    const res = await FindReplaceTool.run(
      {
        glob: '**/*.ts',
        pattern: '^line ',
        replacement: 'LINE ',
        isRegex: true,
        multiline: true,
        rootDir: dir,
      },
      ctx({ cwd: dir }),
    )
    const payload = parseJsonTail(res.output as string)
    expect(payload.previews).toHaveLength(1)
    // All three line starts should be matched.
    const diff = payload.previews[0]!.diff
    expect(diff).toContain('+LINE one')
    expect(diff).toContain('+LINE two')
    expect(diff).toContain('+LINE three')
  })

  it('treats literal-mode regex metacharacters as literals', async () => {
    // In regex this would mean "any char then '.txt'"; in literal mode
    // it should match the exact bytes '.txt'.
    await writeFile(join(dir, 'a.ts'), 'foo.txt and barXtxt\n', 'utf8')

    const res = await FindReplaceTool.run(
      {
        glob: '**/*.ts',
        pattern: '.txt',
        replacement: '.md',
        rootDir: dir,
      },
      ctx({ cwd: dir }),
    )
    const payload = parseJsonTail(res.output as string)
    expect(payload.previews).toHaveLength(1)
    expect(payload.previews[0]!.diff).toContain('+foo.md and barXtxt')
  })
})

describe('FindReplaceTool — non-dryRun writes', () => {
  let dir: string
  beforeEach(async () => {
    dir = await makeTmp()
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('writes when dryRun=false and file is in expectedFiles', async () => {
    const file = join(dir, 'a.ts')
    await writeFile(file, 'foo\n', 'utf8')

    const res = await FindReplaceTool.run(
      {
        glob: '**/*.ts',
        pattern: 'foo',
        replacement: 'bar',
        rootDir: dir,
        dryRun: false,
        expectedFiles: ['a.ts'],
      },
      ctx({ cwd: dir }),
    )
    expect(res.isError).toBe(false)
    const payload = parseJsonTail(res.output as string)
    expect(payload.dryRun).toBe(false)
    expect(payload.applied).toBeDefined()
    expect(payload.applied!).toHaveLength(1)
    expect(payload.applied![0]!.success).toBe(true)

    const after = await readFile(file, 'utf8')
    expect(after).toBe('bar\n')
  })

  it('refuses files matched by glob but not in expectedFiles', async () => {
    const allowed = join(dir, 'allowed.ts')
    const refused = join(dir, 'refused.ts')
    await writeFile(allowed, 'foo\n', 'utf8')
    await writeFile(refused, 'foo\n', 'utf8')

    const res = await FindReplaceTool.run(
      {
        glob: '**/*.ts',
        pattern: 'foo',
        replacement: 'bar',
        rootDir: dir,
        dryRun: false,
        expectedFiles: ['allowed.ts'],
      },
      ctx({ cwd: dir }),
    )
    const payload = parseJsonTail(res.output as string)
    expect(payload.applied).toBeDefined()
    expect(payload.applied!).toHaveLength(2)

    const allowedHit = payload.applied!.find(a => a.path === 'allowed.ts')
    const refusedHit = payload.applied!.find(a => a.path === 'refused.ts')
    expect(allowedHit?.success).toBe(true)
    expect(refusedHit?.success).toBe(false)
    expect(refusedHit?.error).toMatch(/expectedFiles/)

    // allowed file is rewritten, refused file is left alone.
    expect(await readFile(allowed, 'utf8')).toBe('bar\n')
    expect(await readFile(refused, 'utf8')).toBe('foo\n')
  })

  it('accepts absolute paths in expectedFiles', async () => {
    const file = join(dir, 'a.ts')
    await writeFile(file, 'foo\n', 'utf8')

    const res = await FindReplaceTool.run(
      {
        glob: '**/*.ts',
        pattern: 'foo',
        replacement: 'bar',
        rootDir: dir,
        dryRun: false,
        expectedFiles: [file], // absolute
      },
      ctx({ cwd: dir }),
    )
    expect(res.isError).toBe(false)
    const payload = parseJsonTail(res.output as string)
    expect(payload.applied![0]!.success).toBe(true)
    expect(await readFile(file, 'utf8')).toBe('bar\n')
  })
})

describe('FindReplaceTool — maxFiles cap', () => {
  let dir: string
  beforeEach(async () => {
    dir = await makeTmp()
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('truncates when maxFiles<matches and sets truncated=true', async () => {
    for (let i = 0; i < 5; i++) {
      await writeFile(join(dir, `f${i}.ts`), 'hello\n', 'utf8')
    }
    const res = await FindReplaceTool.run(
      {
        glob: '**/*.ts',
        pattern: 'hello',
        replacement: 'hi',
        rootDir: dir,
        maxFiles: 2,
      },
      ctx({ cwd: dir }),
    )
    const payload = parseJsonTail(res.output as string)
    expect(payload.truncated).toBe(true)
    expect(payload.filesScanned).toBe(2)
    expect(payload.filesChanged).toBe(2)
  })

  it('truncated=false when matches fit under maxFiles', async () => {
    await writeFile(join(dir, 'a.ts'), 'hello\n', 'utf8')
    const res = await FindReplaceTool.run(
      {
        glob: '**/*.ts',
        pattern: 'hello',
        replacement: 'hi',
        rootDir: dir,
        maxFiles: 10,
      },
      ctx({ cwd: dir }),
    )
    const payload = parseJsonTail(res.output as string)
    expect(payload.truncated).toBe(false)
  })
})

describe('FindReplaceTool — gitignore', () => {
  let dir: string
  beforeEach(async () => {
    dir = await makeTmp()
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('respectGitignore: true skips files matched by .gitignore', async () => {
    await writeFile(join(dir, '.gitignore'), 'ignored.ts\n', 'utf8')
    await writeFile(join(dir, 'visible.ts'), 'hello\n', 'utf8')
    await writeFile(join(dir, 'ignored.ts'), 'hello\n', 'utf8')

    const res = await FindReplaceTool.run(
      {
        glob: '**/*.ts',
        pattern: 'hello',
        replacement: 'hi',
        rootDir: dir,
        respectGitignore: true,
      },
      ctx({ cwd: dir }),
    )
    const payload = parseJsonTail(res.output as string)
    expect(payload.previews.map(p => p.path)).toEqual(['visible.ts'])
  })

  it('respectGitignore: false picks up files .gitignore would exclude', async () => {
    await writeFile(join(dir, '.gitignore'), 'ignored.ts\n', 'utf8')
    await writeFile(join(dir, 'visible.ts'), 'hello\n', 'utf8')
    await writeFile(join(dir, 'ignored.ts'), 'hello\n', 'utf8')

    const res = await FindReplaceTool.run(
      {
        glob: '**/*.ts',
        pattern: 'hello',
        replacement: 'hi',
        rootDir: dir,
        respectGitignore: false,
      },
      ctx({ cwd: dir }),
    )
    const payload = parseJsonTail(res.output as string)
    expect(payload.previews.map(p => p.path).sort()).toEqual([
      'ignored.ts',
      'visible.ts',
    ])
  })
})

describe('FindReplaceTool — excludePaths', () => {
  let dir: string
  beforeEach(async () => {
    dir = await makeTmp()
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('excludes glob-matching files from the scan', async () => {
    await mkdir(join(dir, 'src'), { recursive: true })
    await mkdir(join(dir, 'test'), { recursive: true })
    await writeFile(join(dir, 'src', 'a.ts'), 'hello\n', 'utf8')
    await writeFile(join(dir, 'test', 'a.ts'), 'hello\n', 'utf8')

    const res = await FindReplaceTool.run(
      {
        glob: '**/*.ts',
        pattern: 'hello',
        replacement: 'hi',
        rootDir: dir,
        excludePaths: ['test/**'],
      },
      ctx({ cwd: dir }),
    )
    const payload = parseJsonTail(res.output as string)
    expect(payload.previews.map(p => p.path)).toEqual(['src/a.ts'])
  })

  it('honours multiple excludePaths entries', async () => {
    await mkdir(join(dir, 'a'), { recursive: true })
    await mkdir(join(dir, 'b'), { recursive: true })
    await mkdir(join(dir, 'c'), { recursive: true })
    await writeFile(join(dir, 'a', 'f.ts'), 'hello\n', 'utf8')
    await writeFile(join(dir, 'b', 'f.ts'), 'hello\n', 'utf8')
    await writeFile(join(dir, 'c', 'f.ts'), 'hello\n', 'utf8')

    const res = await FindReplaceTool.run(
      {
        glob: '**/*.ts',
        pattern: 'hello',
        replacement: 'hi',
        rootDir: dir,
        excludePaths: ['a/**', 'b/**'],
      },
      ctx({ cwd: dir }),
    )
    const payload = parseJsonTail(res.output as string)
    expect(payload.previews.map(p => p.path)).toEqual(['c/f.ts'])
  })
})

describe('FindReplaceTool — AbortSignal', () => {
  let dir: string
  beforeEach(async () => {
    dir = await makeTmp()
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('returns a partial result when the signal is already aborted', async () => {
    await writeFile(join(dir, 'a.ts'), 'hello\n', 'utf8')
    await writeFile(join(dir, 'b.ts'), 'hello\n', 'utf8')

    const ac = new AbortController()
    ac.abort()
    const payload = await runFindReplace(
      {
        glob: '**/*.ts',
        pattern: 'hello',
        replacement: 'hi',
        rootDir: dir,
      },
      ac.signal,
    )
    expect(payload.aborted).toBe(true)
    // No scans should have completed; either way, no exception.
    expect(payload.filesChanged).toBe(0)
  })

  it('returns a partial result when the signal aborts mid-iteration', async () => {
    // Create a handful of files so the per-file loop has somewhere to
    // observe the abort.
    for (let i = 0; i < 10; i++) {
      await writeFile(join(dir, `f${i}.ts`), 'hello\n', 'utf8')
    }
    const ac = new AbortController()
    // Abort almost immediately after starting the scan. The walker
    // checks aborted between entries so we should see SOMETHING but
    // not necessarily all 10.
    queueMicrotask(() => ac.abort())
    const payload = await runFindReplace(
      {
        glob: '**/*.ts',
        pattern: 'hello',
        replacement: 'hi',
        rootDir: dir,
      },
      ac.signal,
    )
    expect(payload.aborted).toBe(true)
    expect(payload.filesScanned).toBeLessThanOrEqual(10)
  })
})

describe('FindReplaceTool — output format', () => {
  let dir: string
  beforeEach(async () => {
    dir = await makeTmp()
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('includes a human header line plus a trailing JSON payload', async () => {
    await writeFile(join(dir, 'a.ts'), 'foo\n', 'utf8')
    const res = await FindReplaceTool.run(
      {
        glob: '**/*.ts',
        pattern: 'foo',
        replacement: 'bar',
        rootDir: dir,
      },
      ctx({ cwd: dir }),
    )
    const output = res.output as string
    expect(output.startsWith('FindReplace (dryRun):')).toBe(true)
    expect(output).toMatch(/scanned=1 changed=1/)
    // The last line should parse as JSON and contain our structured fields.
    const json = parseJsonTail(output)
    expect(json.filesScanned).toBe(1)
    expect(json.filesChanged).toBe(1)
  })
})
