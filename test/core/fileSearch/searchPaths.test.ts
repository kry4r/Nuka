// test/core/fileSearch/searchPaths.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildIndexFromDir,
  promoteRecent,
  searchPaths,
} from '../../../src/core/fileSearch/searchPaths'
import type { SearchResult } from '../../../src/core/fileSearch/fileIndex'

async function makeTree(root: string): Promise<void> {
  await mkdir(join(root, 'src', 'core'), { recursive: true })
  await mkdir(join(root, 'src', 'tui'), { recursive: true })
  await mkdir(join(root, 'test', 'core'), { recursive: true })
  await writeFile(join(root, 'package.json'), '{}')
  await writeFile(join(root, 'README.md'), '#')
  await writeFile(join(root, 'src', 'cli.tsx'), '')
  await writeFile(join(root, 'src', 'core', 'registry.ts'), '')
  await writeFile(join(root, 'src', 'core', 'tools.ts'), '')
  await writeFile(join(root, 'src', 'tui', 'PromptInput.tsx'), '')
  await writeFile(join(root, 'test', 'core', 'registry.test.ts'), '')
}

describe('searchPaths', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nuka-fileSearch-sp-'))
    await makeTree(dir)
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('returns ranked matches for a query against a real directory', async () => {
    const r = await searchPaths({ rootDir: dir, query: 'cli', maxResults: 5 })
    expect(r.length).toBeGreaterThan(0)
    expect(r[0]!.path).toBe('src/cli.tsx')
  })

  it('empty query returns top-level entries', async () => {
    const r = await searchPaths({ rootDir: dir, query: '', maxResults: 10 })
    expect(r.length).toBeGreaterThan(0)
    // Top-level should include 'src', 'test', or top-level filenames.
    const paths = r.map(x => x.path)
    expect(
      paths.includes('src') ||
        paths.includes('test') ||
        paths.includes('package.json'),
    ).toBe(true)
  })

  it('respects maxResults', async () => {
    const r = await searchPaths({ rootDir: dir, query: 's', maxResults: 2 })
    expect(r.length).toBeLessThanOrEqual(2)
  })

  it('returns empty for query with no matches', async () => {
    const r = await searchPaths({
      rootDir: dir,
      query: 'qqqqqqqqq',
      maxResults: 5,
    })
    expect(r).toEqual([])
  })

  it('recentFiles promotes matching paths to the front', async () => {
    // Both 'src/core/registry.ts' and 'test/core/registry.test.ts' match
    // 'reg'. Without the recents nudge, the shorter / non-test path
    // typically wins. Mark the test path as "recent" — it should
    // now appear first.
    const r = await searchPaths({
      rootDir: dir,
      query: 'reg',
      maxResults: 5,
      recentFiles: ['test/core/registry.test.ts'],
    })
    expect(r.length).toBeGreaterThan(0)
    expect(r[0]!.path).toBe('test/core/registry.test.ts')
  })
})

describe('buildIndexFromDir', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nuka-fileSearch-bi-'))
    await makeTree(dir)
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('builds a reusable FileIndex from a directory', async () => {
    const idx = await buildIndexFromDir({ rootDir: dir })
    expect(idx.size()).toBeGreaterThan(0)
    const r1 = idx.search('cli', 5)
    const r2 = idx.search('registry', 5)
    expect(r1.length).toBeGreaterThan(0)
    expect(r2.length).toBeGreaterThan(0)
  })
})

describe('promoteRecent', () => {
  const mkResult = (path: string, score: number): SearchResult => ({
    path,
    score,
  })

  it('returns input unchanged when recents list is empty', () => {
    const scored = [mkResult('a', 0), mkResult('b', 0.5)]
    expect(promoteRecent(scored, [], 5)).toEqual(scored)
  })

  it('returns input unchanged (truncated to limit) when no recents match', () => {
    const scored = [mkResult('a', 0), mkResult('b', 0.5)]
    const r = promoteRecent(scored, ['z/never.ts'], 5)
    expect(r.map(x => x.path)).toEqual(['a', 'b'])
  })

  it('promotes a single matching recent to position 0', () => {
    const scored = [
      mkResult('src/a.ts', 0),
      mkResult('src/b.ts', 0.5),
      mkResult('src/c.ts', 1),
    ]
    const r = promoteRecent(scored, ['src/c.ts'], 5)
    expect(r[0]!.path).toBe('src/c.ts')
    expect(r[1]!.path).toBe('src/a.ts')
    expect(r[2]!.path).toBe('src/b.ts')
  })

  it('preserves recents order across multiple promotions', () => {
    const scored = [
      mkResult('a', 0),
      mkResult('b', 0.3),
      mkResult('c', 0.6),
      mkResult('d', 1),
    ]
    const r = promoteRecent(scored, ['c', 'a'], 5)
    expect(r.map(x => x.path)).toEqual(['c', 'a', 'b', 'd'])
  })

  it('re-stamps scores so they remain monotonically ascending', () => {
    const scored = [mkResult('a', 0), mkResult('b', 0.5), mkResult('c', 1)]
    const r = promoteRecent(scored, ['c'], 5)
    for (let i = 1; i < r.length; i++) {
      expect(r[i]!.score).toBeGreaterThanOrEqual(r[i - 1]!.score)
    }
  })

  it('respects maxResults after promotion', () => {
    const scored = [
      mkResult('a', 0),
      mkResult('b', 0.25),
      mkResult('c', 0.5),
      mkResult('d', 0.75),
      mkResult('e', 1),
    ]
    const r = promoteRecent(scored, ['e'], 3)
    expect(r.length).toBe(3)
    expect(r[0]!.path).toBe('e')
  })
})
