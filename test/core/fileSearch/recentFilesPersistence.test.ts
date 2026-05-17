// test/core/fileSearch/recentFilesPersistence.test.ts
//
// Persistence-focused coverage for `recentFiles.ts` (Iter OOO).
//
// `recentFiles.test.ts` already covers the in-memory MRU semantics and a
// happy-path JSON round-trip. This file focuses on the disk-layer
// behaviours the persistence story actually has to make good on:
//
//   - atomic save (tmp file appears + is renamed; no half-written
//     `.json` if the renamer hiccups)
//   - missing / malformed / wrong-version / wrong-shape files are
//     loaded as an empty tracker without throwing
//   - per-entry filtering: a payload with a mix of good and bad entries
//     still yields the good ones (we don't reject the whole file on one
//     bad row)
//   - mkdir is recursive (a never-existed nested dir works)
//   - `defaultRecentFilesPath` lands under `$HOME/.nuka`
//   - the `PersistentRecentFiles` wrapper writes through on touch and
//     also tolerates an unwriteable target
//
// All disk IO goes through `mkdtemp`/`rm` fixtures so the user's real
// `~/.nuka/recent-files.json` is never touched by this suite.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  RecentFiles,
  createPersistentRecentFiles,
  defaultRecentFilesPath,
  loadRecentFiles,
  persistRecentFiles,
} from '../../../src/core/fileSearch/recentFiles'

describe('recentFiles persistence — atomic save', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nuka-recent-persist-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('persists a tracker to JSON at the target path', async () => {
    const path = join(dir, 'state.json')
    const t = new RecentFiles()
    t.touch('alpha', 100)
    t.touch('beta', 200)
    await persistRecentFiles(t, path)

    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as {
      v: number
      entries: Array<{ path: string; timestamp: number; hits: number }>
    }
    expect(parsed.v).toBe(1)
    expect(parsed.entries.map(e => e.path)).toEqual(['alpha', 'beta'])
  })

  it('does not leave a tmp file behind after a successful save', async () => {
    const path = join(dir, 'state.json')
    const t = new RecentFiles()
    t.touch('only', 1)
    await persistRecentFiles(t, path)

    const files = await readdir(dir)
    // The only persisted artefact should be the final JSON file. tmp
    // suffixes use `.tmp-<pid>-<ms>` — assert none survive.
    expect(files).toEqual(['state.json'])
  })

  it('creates nested parent directories that did not exist', async () => {
    const path = join(dir, 'nested', 'deep', 'state.json')
    const t = new RecentFiles()
    t.touch('only', 1)
    await persistRecentFiles(t, path)

    const raw = await readFile(path, 'utf8')
    expect(JSON.parse(raw).v).toBe(1)
  })

  it('overwrites the existing file in place via rename (final file always parseable)', async () => {
    const path = join(dir, 'state.json')
    // First write.
    const a = new RecentFiles()
    a.touch('first', 1)
    await persistRecentFiles(a, path)
    // Second write with different contents.
    const b = new RecentFiles()
    b.touch('second', 2)
    await persistRecentFiles(b, path)

    // The file at `path` should always be valid JSON — never half-written.
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as { entries: Array<{ path: string }> }
    expect(parsed.entries.map(e => e.path)).toEqual(['second'])
  })
})

describe('recentFiles persistence — forgiving load', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nuka-recent-persist-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('missing file → empty tracker (no throw)', async () => {
    const t = await loadRecentFiles(join(dir, 'does-not-exist.json'))
    expect(t.list()).toEqual([])
    expect(t.size).toBe(0)
  })

  it('malformed JSON → empty tracker (no throw)', async () => {
    const path = join(dir, 'broken.json')
    await writeFile(path, '{ this is :: not :: json', 'utf8')
    const t = await loadRecentFiles(path)
    expect(t.list()).toEqual([])
  })

  it('non-object JSON (e.g. a bare array) → empty tracker', async () => {
    const path = join(dir, 'array.json')
    await writeFile(path, '[1,2,3]', 'utf8')
    const t = await loadRecentFiles(path)
    expect(t.list()).toEqual([])
  })

  it('wrong version field → empty tracker', async () => {
    const path = join(dir, 'v999.json')
    await writeFile(
      path,
      JSON.stringify({
        v: 999,
        entries: [{ path: 'should-be-ignored', timestamp: 1, hits: 1 }],
        opts: { maxEntries: 64, decayHalfLifeMs: 3_600_000 },
      }),
      'utf8',
    )
    const t = await loadRecentFiles(path)
    expect(t.list()).toEqual([])
  })

  it('entries field is not an array → empty tracker', async () => {
    const path = join(dir, 'wrong-entries.json')
    await writeFile(
      path,
      JSON.stringify({ v: 1, entries: 'not-an-array' }),
      'utf8',
    )
    const t = await loadRecentFiles(path)
    expect(t.list()).toEqual([])
  })

  it('filters out entries with non-string paths but keeps the good ones', async () => {
    const path = join(dir, 'mixed.json')
    await writeFile(
      path,
      JSON.stringify({
        v: 1,
        entries: [
          { path: 'keep-me', timestamp: 100, hits: 1 },
          { path: 42, timestamp: 200, hits: 1 }, // non-string path → drop
          { path: 'also-keep', timestamp: 300, hits: 2 },
          { path: null, timestamp: 400, hits: 1 }, // null path → drop
          { path: 'final-keep', timestamp: 500, hits: 1 },
        ],
        opts: { maxEntries: 64, decayHalfLifeMs: 3_600_000 },
      }),
      'utf8',
    )
    const t = await loadRecentFiles(path)
    // Freshest first; non-string-path entries dropped.
    expect(t.list()).toEqual(['final-keep', 'also-keep', 'keep-me'])
  })

  it('filters out entries with bad timestamps / hits while keeping the rest', async () => {
    const path = join(dir, 'mixed-numbers.json')
    await writeFile(
      path,
      JSON.stringify({
        v: 1,
        entries: [
          { path: 'good-1', timestamp: 100, hits: 1 },
          { path: 'bad-ts', timestamp: 'oops', hits: 1 },
          { path: 'bad-hits', timestamp: 200, hits: 'oops' },
          { path: 'good-2', timestamp: 300, hits: 2 },
        ],
        opts: { maxEntries: 64, decayHalfLifeMs: 3_600_000 },
      }),
      'utf8',
    )
    const t = await loadRecentFiles(path)
    expect(t.list()).toEqual(['good-2', 'good-1'])
  })
})

describe('recentFiles persistence — defaultRecentFilesPath', () => {
  it('returns a path under .nuka/recent-files.json', () => {
    const p = defaultRecentFilesPath()
    // Cross-platform path-separator check via regex so the test passes
    // on both POSIX and Windows (Nuka targets darwin/linux primarily,
    // but the suffix check is cheap).
    expect(p).toMatch(/[\\/]\.nuka[\\/]recent-files\.json$/)
  })
})

describe('createPersistentRecentFiles — disk wiring', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nuka-recent-persistent-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('round-trips touches across two sessions on the same file', async () => {
    const path = join(dir, 'state.json')
    const first = await createPersistentRecentFiles({ path })
    first.touch('a', 100)
    first.touch('b', 200)
    first.touch('c', 300)
    await first.flush()

    const second = await createPersistentRecentFiles({ path })
    expect(second.list()).toEqual(['c', 'b', 'a'])
  })

  it('flush is a no-op when no writes are pending', async () => {
    const path = join(dir, 'state.json')
    const t = await createPersistentRecentFiles({ path })
    await expect(t.flush()).resolves.toBeUndefined()
  })

  it('coalesces a flurry of touches into a single consistent on-disk state', async () => {
    const path = join(dir, 'state.json')
    const t = await createPersistentRecentFiles({ path })
    for (let i = 0; i < 30; i++) t.touch(`p${i}`, 1_000 + i)
    await t.flush()

    const reloaded = await loadRecentFiles(path)
    const list = reloaded.list()
    expect(list[0]).toBe('p29')
    expect(list.length).toBe(30)
  })

  it('forget / clear are persisted just like touch', async () => {
    const path = join(dir, 'state.json')
    const t = await createPersistentRecentFiles({ path })
    t.touch('alpha', 1)
    t.touch('beta', 2)
    await t.flush()
    t.forget('alpha')
    await t.flush()
    expect((await loadRecentFiles(path)).list()).toEqual(['beta'])
    t.clear()
    await t.flush()
    expect((await loadRecentFiles(path)).list()).toEqual([])
  })

  it('seeds a tracker with no path-file (fresh user)', async () => {
    const path = join(dir, 'never-existed.json')
    const t = await createPersistentRecentFiles({ path })
    expect(t.list()).toEqual([])
    t.touch('first', 1)
    await t.flush()
    expect((await loadRecentFiles(path)).list()).toEqual(['first'])
  })

  it('persists into nested directories the user never made', async () => {
    const path = join(dir, 'a', 'b', 'c', 'state.json')
    const t = await createPersistentRecentFiles({ path })
    t.touch('deep', 7)
    await t.flush()
    expect((await loadRecentFiles(path)).list()).toEqual(['deep'])
  })

  it('tolerates a malformed pre-existing file by starting empty', async () => {
    const path = join(dir, 'broken.json')
    await mkdir(dir, { recursive: true })
    await writeFile(path, 'not json at all ::::', 'utf8')
    const t = await createPersistentRecentFiles({ path })
    expect(t.list()).toEqual([])
    // And a fresh touch still persists correctly afterwards.
    t.touch('recovered', 1)
    await t.flush()
    expect((await loadRecentFiles(path)).list()).toEqual(['recovered'])
  })
})
