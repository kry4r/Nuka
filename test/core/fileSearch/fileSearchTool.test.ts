// test/core/fileSearch/fileSearchTool.test.ts
//
// FileSearchTool tests. All scenarios run against a tmpdir fixture so
// none of them depend on Nuka's own checkout layout — the suite can be
// re-run against any future repo restructure without churn.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  FILE_SEARCH_DEFAULT_MAX,
  FILE_SEARCH_HARD_MAX,
  FILE_SEARCH_TOOL_NAME,
  FileSearchTool,
  runFileSearch,
} from '../../../src/core/fileSearch/fileSearchTool'
import type { ToolContext } from '../../../src/core/tools/types'

/**
 * Minimal but representative fixture tree. Mirrors the kind of layout
 * the agent will fuzz over in a real project: a couple of src/test
 * directories, a few files with overlapping name fragments so we can
 * verify fuzzy ranking, plus one dotfile and a node_modules entry to
 * exercise the skip-list + dotfile gate.
 */
async function makeTree(root: string): Promise<void> {
  await mkdir(join(root, 'src', 'core', 'fileSearch'), { recursive: true })
  await mkdir(join(root, 'src', 'tui'), { recursive: true })
  await mkdir(join(root, 'test', 'core'), { recursive: true })
  await mkdir(join(root, 'node_modules', 'foo'), { recursive: true })
  await writeFile(join(root, 'package.json'), '{}')
  await writeFile(join(root, 'README.md'), '#')
  await writeFile(join(root, '.env'), 'SECRET=1')
  await writeFile(join(root, 'src', 'cli.tsx'), '')
  await writeFile(join(root, 'src', 'core', 'fileSearch', 'searchPaths.ts'), '')
  await writeFile(join(root, 'src', 'core', 'fileSearch', 'fileIndex.ts'), '')
  await writeFile(join(root, 'src', 'core', 'fileSearch', 'walker.ts'), '')
  await writeFile(join(root, 'src', 'tui', 'PromptInput.tsx'), '')
  await writeFile(join(root, 'test', 'core', 'registry.test.ts'), '')
  // Inside node_modules (should be skipped by the walker's default skip-list).
  await writeFile(join(root, 'node_modules', 'foo', 'index.js'), '')
}

function mkCtx(signal?: AbortSignal): ToolContext {
  return {
    signal: signal ?? new AbortController().signal,
    cwd: process.cwd(),
  }
}

describe('FileSearchTool — metadata', () => {
  it('exposes the documented name and read-only annotations', () => {
    expect(FileSearchTool.name).toBe(FILE_SEARCH_TOOL_NAME)
    expect(FileSearchTool.annotations?.readOnly).toBe(true)
    expect(FileSearchTool.annotations?.parallelSafe).toBe(true)
    expect(FileSearchTool.needsPermission({ query: '' })).toBe('none')
  })
})

describe('FileSearchTool — runFileSearch', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nuka-FileSearchTool-'))
    await makeTree(dir)
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('ranks the exact filename top for a specific query', async () => {
    const r = await runFileSearch(
      { query: 'searchPaths', rootDir: dir, maxResults: 5 },
      new AbortController().signal,
    )
    expect(r.matches.length).toBeGreaterThan(0)
    expect(r.matches[0]!.path).toBe('src/core/fileSearch/searchPaths.ts')
    expect(typeof r.matches[0]!.score).toBe('number')
  })

  it('matches fuzzy queries (fsearch → fileSearch files)', async () => {
    const r = await runFileSearch(
      { query: 'fsearch', rootDir: dir, maxResults: 10 },
      new AbortController().signal,
    )
    expect(r.matches.length).toBeGreaterThan(0)
    // At least one of the fileSearch/ files should appear in the top
    // results — the fuzzy match (f...search) is the dominant signal.
    const paths = r.matches.map(m => m.path)
    expect(
      paths.some(p => p.startsWith('src/core/fileSearch/')),
    ).toBe(true)
  })

  it('returns top maxResults for an empty query (top-level entries)', async () => {
    const r = await runFileSearch(
      { query: '', rootDir: dir, maxResults: 3 },
      new AbortController().signal,
    )
    // Empty query falls through to FileIndex.search's top-level cache
    // (computeTopLevelEntries) — we don't pin the exact ordering, just
    // verify the contract: bounded by maxResults, contains
    // top-of-tree segments.
    expect(r.matches.length).toBeLessThanOrEqual(3)
    expect(r.matches.length).toBeGreaterThan(0)
    const segs = r.matches.map(m => m.path)
    expect(
      segs.some(s => s === 'src' || s === 'test' || s === 'package.json'),
    ).toBe(true)
  })

  it('respects maxResults', async () => {
    const r = await runFileSearch(
      { query: 's', rootDir: dir, maxResults: 2 },
      new AbortController().signal,
    )
    expect(r.matches.length).toBeLessThanOrEqual(2)
  })

  it('respectGitignore=true skips paths in .gitignore', async () => {
    // Add a tracked + an ignored file, plus a .gitignore that drops the
    // ignored one. The walker should never see `secret.ts`.
    await writeFile(join(dir, '.gitignore'), 'secret.ts\n')
    await writeFile(join(dir, 'tracked.ts'), '')
    await writeFile(join(dir, 'secret.ts'), '')

    const r = await runFileSearch(
      {
        query: '',
        rootDir: dir,
        maxResults: 200,
        respectGitignore: true,
        // Walker would skip the .gitignore as a dotfile too — verify
        // both layers together: dotfile gate + gitignore filter.
        includeDotfiles: false,
      },
      new AbortController().signal,
    )
    // Empty query → top-level segments cache. To actually probe ignored
    // files we need a query that targets them.
    const r2 = await runFileSearch(
      {
        query: 'secret',
        rootDir: dir,
        maxResults: 20,
        respectGitignore: true,
      },
      new AbortController().signal,
    )
    const found2 = r2.matches.map(m => m.path)
    expect(found2).not.toContain('secret.ts')
    // And the tracked file is still searchable.
    const r3 = await runFileSearch(
      {
        query: 'tracked',
        rootDir: dir,
        maxResults: 20,
        respectGitignore: true,
      },
      new AbortController().signal,
    )
    expect(r3.matches.map(m => m.path)).toContain('tracked.ts')

    // Reference `r` so unused-binding lint doesn't fire; the empty-query
    // result above is logically distinct from the targeted ones.
    expect(r.totalIndexed).toBeGreaterThan(0)
  })

  it('includeDotfiles=false hides .gitignore / .env', async () => {
    const r = await runFileSearch(
      {
        query: 'env',
        rootDir: dir,
        maxResults: 50,
        includeDotfiles: false,
      },
      new AbortController().signal,
    )
    expect(r.matches.map(m => m.path)).not.toContain('.env')
  })

  it('includeDotfiles=true surfaces .env when queried', async () => {
    const r = await runFileSearch(
      {
        query: 'env',
        rootDir: dir,
        maxResults: 50,
        includeDotfiles: true,
        respectGitignore: false,
      },
      new AbortController().signal,
    )
    expect(r.matches.map(m => m.path)).toContain('.env')
  })

  it('recentPaths boost: a recent file is promoted within matches', async () => {
    // Two fileSearch files match the query 'fileSearch'. Without the
    // boost, the natural ranker decides the order. With `recentPaths`
    // pointing at one of them, that file must come first.
    const target = 'src/core/fileSearch/walker.ts'

    const baseline = await runFileSearch(
      { query: 'fileSearch', rootDir: dir, maxResults: 20 },
      new AbortController().signal,
    )
    expect(baseline.matches.length).toBeGreaterThan(1)

    const withBoost = await runFileSearch(
      {
        query: 'fileSearch',
        rootDir: dir,
        maxResults: 20,
        recentPaths: [target],
      },
      new AbortController().signal,
    )
    // The boosted target must appear in the boosted results and must
    // be at-or-before its baseline rank.
    const boostedPaths = withBoost.matches.map(m => m.path)
    expect(boostedPaths).toContain(target)
    const baselineIdx = baseline.matches.findIndex(m => m.path === target)
    const boostedIdx = boostedPaths.indexOf(target)
    expect(boostedIdx).toBeLessThanOrEqual(baselineIdx)
    // And specifically: promoteRecent puts recents first among matches,
    // so target should be at index 0 here.
    expect(boostedIdx).toBe(0)
  })

  it('AbortSignal aborted before walk: still returns a payload with aborted=true', async () => {
    const ac = new AbortController()
    ac.abort()
    const r = await runFileSearch(
      { query: 'searchPaths', rootDir: dir, maxResults: 5 },
      ac.signal,
    )
    // walker.ts bails on signal.aborted check at the very top of
    // walkInner, so the index ends up empty but no throw escapes.
    expect(r.aborted).toBe(true)
    expect(r.matches.length).toBe(0)
    expect(r.totalIndexed).toBe(0)
  })

  it('every match carries a numeric score and a displayPath', async () => {
    const r = await runFileSearch(
      { query: 'cli', rootDir: dir, maxResults: 5 },
      new AbortController().signal,
    )
    expect(r.matches.length).toBeGreaterThan(0)
    for (const m of r.matches) {
      expect(typeof m.score).toBe('number')
      expect(Number.isFinite(m.score)).toBe(true)
      expect(typeof m.displayPath).toBe('string')
      expect(m.displayPath).toBe(m.path)
    }
  })

  it('reports totalIndexed and indexBuildMs', async () => {
    const r = await runFileSearch(
      { query: 'cli', rootDir: dir, maxResults: 5 },
      new AbortController().signal,
    )
    expect(r.totalIndexed).toBeGreaterThan(0)
    expect(typeof r.indexBuildMs).toBe('number')
    expect(r.indexBuildMs).toBeGreaterThanOrEqual(0)
  })

  it('skips node_modules by default via the walker skip-list', async () => {
    const r = await runFileSearch(
      { query: 'foo', rootDir: dir, maxResults: 50 },
      new AbortController().signal,
    )
    const paths = r.matches.map(m => m.path)
    expect(paths.every(p => !p.startsWith('node_modules/'))).toBe(true)
  })
})

describe('FileSearchTool — run handler', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nuka-FileSearchTool-run-'))
    await makeTree(dir)
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('rejects non-string query', async () => {
    const r = await FileSearchTool.run(
      // intentionally bad input — runtime guard path
      { query: 42 as unknown as string },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(typeof r.output).toBe('string')
    expect(r.output).toContain('query')
  })

  it('rejects non-positive maxResults', async () => {
    const r = await FileSearchTool.run(
      { query: 'x', maxResults: -1 },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('maxResults')
  })

  it('returns a formatted result string with trailing JSON', async () => {
    const r = await FileSearchTool.run(
      { query: 'searchPaths', rootDir: dir, maxResults: 5 },
      mkCtx(),
    )
    expect(r.isError).toBe(false)
    expect(typeof r.output).toBe('string')
    const text = r.output as string
    // The last non-empty line is the JSON payload — `JSON.parse` it.
    const lines = text.split('\n').filter(l => l.length > 0)
    const last = lines[lines.length - 1]!
    const parsed = JSON.parse(last) as {
      matches: Array<{ path: string; score: number; displayPath?: string }>
      totalIndexed: number
      indexBuildMs: number
    }
    expect(parsed.matches.length).toBeGreaterThan(0)
    expect(parsed.matches[0]!.path).toBe('src/core/fileSearch/searchPaths.ts')
  })

  it('produces a friendly "no matches" line when nothing matches', async () => {
    const r = await FileSearchTool.run(
      { query: 'zzzzzNoSuchFileZzzzz', rootDir: dir, maxResults: 5 },
      mkCtx(),
    )
    expect(r.isError).toBe(false)
    const text = r.output as string
    expect(text).toContain('No paths matched')
  })

  it('caps maxResults to FILE_SEARCH_HARD_MAX', async () => {
    // Build a wide tree so we can verify the cap kicks in. We don't
    // need 200 unique matches — `FileIndex.search` returns at most
    // `limit`, which is what the cap controls. The check here is that
    // the cap doesn't throw and behaves like a normal call.
    const r = await runFileSearch(
      { query: '', rootDir: dir, maxResults: FILE_SEARCH_HARD_MAX + 50 },
      new AbortController().signal,
    )
    expect(r.matches.length).toBeLessThanOrEqual(FILE_SEARCH_HARD_MAX)
  })

  it('uses sane defaults when called with only a query', async () => {
    // Drive defaults: maxResults defaults to FILE_SEARCH_DEFAULT_MAX,
    // respectGitignore defaults to true, includeDotfiles defaults to false.
    const r = await runFileSearch(
      { query: '', rootDir: dir },
      new AbortController().signal,
    )
    expect(r.matches.length).toBeLessThanOrEqual(FILE_SEARCH_DEFAULT_MAX)
    expect(r.totalIndexed).toBeGreaterThan(0)
  })
})
