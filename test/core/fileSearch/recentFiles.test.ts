// test/core/fileSearch/recentFiles.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  RecentFiles,
  createPersistentRecentFiles,
  defaultRecentFilesPath,
  loadRecentFiles,
  persistRecentFiles,
} from '../../../src/core/fileSearch/recentFiles'

describe('RecentFiles — basics', () => {
  it('empty tracker returns empty list and zero boost', () => {
    const t = new RecentFiles()
    expect(t.list()).toEqual([])
    expect(t.entriesSnapshot()).toEqual([])
    expect(t.boost('any/path.ts')).toBe(0)
    expect(t.size).toBe(0)
  })

  it('touch records a path and list returns it freshest-first', () => {
    let clock = 1000
    const t = new RecentFiles({ now: () => clock })
    t.touch('a.ts')
    clock += 5
    t.touch('b.ts')
    clock += 5
    t.touch('c.ts')
    expect(t.list()).toEqual(['c.ts', 'b.ts', 'a.ts'])
    expect(t.size).toBe(3)
  })

  it('empty-string path is ignored', () => {
    const t = new RecentFiles()
    t.touch('')
    expect(t.list()).toEqual([])
    expect(t.size).toBe(0)
  })

  it('re-touching a path moves it to the front and bumps hits', () => {
    let clock = 1000
    const t = new RecentFiles({ now: () => clock })
    t.touch('a.ts')
    clock += 10
    t.touch('b.ts')
    clock += 10
    t.touch('a.ts')
    expect(t.list()).toEqual(['a.ts', 'b.ts'])
    const snap = t.entriesSnapshot()
    expect(snap[0]).toMatchObject({ path: 'a.ts', hits: 2 })
    expect(snap[1]).toMatchObject({ path: 'b.ts', hits: 1 })
    expect(snap[0]!.timestamp).toBeGreaterThan(snap[1]!.timestamp)
    // No duplicates.
    expect(t.size).toBe(2)
  })

  it('maxEntries evicts the oldest entry', () => {
    let clock = 0
    const t = new RecentFiles({ maxEntries: 3, now: () => clock })
    t.touch('one')
    clock += 1
    t.touch('two')
    clock += 1
    t.touch('three')
    clock += 1
    t.touch('four')
    expect(t.list()).toEqual(['four', 'three', 'two'])
    expect(t.size).toBe(3)
    // 'one' is gone.
    expect(t.boost('one')).toBe(0)
  })

  it('forget removes a path; clear empties everything', () => {
    const t = new RecentFiles()
    t.touch('a')
    t.touch('b')
    t.touch('c')
    t.forget('b')
    expect(t.list()).toEqual(['c', 'a'])
    expect(t.boost('b')).toBe(0)
    t.clear()
    expect(t.list()).toEqual([])
    expect(t.size).toBe(0)
  })

  it('forget on unknown path is a no-op', () => {
    const t = new RecentFiles()
    t.touch('a')
    t.forget('not-there')
    expect(t.list()).toEqual(['a'])
  })
})

describe('RecentFiles — boost / recency decay', () => {
  it('boost is in [0,1] and unknown paths score 0', () => {
    const t = new RecentFiles({ now: () => 0 })
    t.touch('a', 0)
    const b = t.boost('a', 0)
    expect(b).toBeGreaterThan(0)
    expect(b).toBeLessThanOrEqual(1)
    expect(t.boost('missing.ts', 0)).toBe(0)
  })

  it('boost decays toward zero as elapsed time grows past half-life', () => {
    const half = 1000
    const t = new RecentFiles({
      decayHalfLifeMs: half,
      now: () => 0,
    })
    t.touch('a', 0)
    const fresh = t.boost('a', 0)
    const oneHalf = t.boost('a', half)
    const twoHalves = t.boost('a', half * 2)
    const distant = t.boost('a', half * 20)
    expect(fresh).toBeGreaterThan(oneHalf)
    expect(oneHalf).toBeGreaterThan(twoHalves)
    expect(twoHalves).toBeGreaterThan(distant)
    // Sanity: oneHalf should be roughly half of fresh (within decay shape).
    expect(oneHalf).toBeGreaterThan(fresh * 0.4)
    expect(oneHalf).toBeLessThan(fresh * 0.6)
    expect(distant).toBeLessThan(0.01)
  })

  it('frequently-touched paths get a small hit bonus over equal-recency one-offs', () => {
    const half = 1000
    const t = new RecentFiles({
      decayHalfLifeMs: half,
      now: () => 0,
    })
    // Both touched at the same final timestamp; one repeatedly, one once.
    t.touch('hot', 100)
    t.touch('hot', 100)
    t.touch('hot', 100)
    t.touch('hot', 100)
    t.touch('hot', 100)
    t.touch('cold', 100)
    expect(t.boost('hot', 100)).toBeGreaterThan(t.boost('cold', 100))
  })
})

describe('RecentFiles — JSON round-trip', () => {
  it('toJSON / fromJSON preserves order, timestamps, and hits', () => {
    const a = new RecentFiles({ maxEntries: 8, decayHalfLifeMs: 500 })
    a.touch('one', 100)
    a.touch('two', 200)
    a.touch('two', 250) // second hit
    a.touch('three', 300)
    const data = a.toJSON()
    expect(data.v).toBe(1)
    expect(data.opts.maxEntries).toBe(8)
    expect(data.opts.decayHalfLifeMs).toBe(500)
    // Emitted oldest → freshest.
    expect(data.entries.map(e => e.path)).toEqual(['one', 'two', 'three'])
    expect(data.entries[1]).toMatchObject({ path: 'two', hits: 2 })

    const b = new RecentFiles()
    b.fromJSON(data)
    expect(b.list()).toEqual(['three', 'two', 'one'])
    const snap = b.entriesSnapshot()
    expect(snap[0]).toMatchObject({ path: 'three', timestamp: 300, hits: 1 })
    expect(snap[1]).toMatchObject({ path: 'two', timestamp: 250, hits: 2 })
  })

  it('fromJSON skips entries with bad fields rather than throwing', () => {
    const t = new RecentFiles()
    t.fromJSON({
      v: 1,
      opts: { maxEntries: 8, decayHalfLifeMs: 500 },
      entries: [
        { path: 'ok', timestamp: 100, hits: 1 },
        // bad path
        { path: '', timestamp: 100, hits: 1 },
        // bad timestamp
        { path: 'b', timestamp: Number.NaN, hits: 1 },
        // bad hits
        { path: 'c', timestamp: 100, hits: Number.NaN },
        { path: 'also-ok', timestamp: 200, hits: 3 },
      ],
    })
    expect(t.list()).toEqual(['also-ok', 'ok'])
  })

  it('fromJSON re-applies maxEntries cap', () => {
    const t = new RecentFiles({ maxEntries: 2 })
    t.fromJSON({
      v: 1,
      opts: { maxEntries: 10, decayHalfLifeMs: 500 },
      entries: [
        { path: 'a', timestamp: 100, hits: 1 },
        { path: 'b', timestamp: 200, hits: 1 },
        { path: 'c', timestamp: 300, hits: 1 },
        { path: 'd', timestamp: 400, hits: 1 },
      ],
    })
    // Oldest (a, b) evicted under the local cap.
    expect(t.list()).toEqual(['d', 'c'])
  })
})

describe('RecentFiles — persistence helpers', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nuka-recent-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('persistRecentFiles + loadRecentFiles round-trips through tmpdir', async () => {
    const path = join(dir, 'state.json')
    const a = new RecentFiles({ maxEntries: 8 })
    a.touch('one', 1_000)
    a.touch('two', 2_000)
    a.touch('three', 3_000)
    await persistRecentFiles(a, path)

    const b = await loadRecentFiles(path)
    expect(b.list()).toEqual(['three', 'two', 'one'])
  })

  it('persist creates missing parent directories', async () => {
    const path = join(dir, 'nested', 'deep', 'state.json')
    const t = new RecentFiles()
    t.touch('only', 42)
    await persistRecentFiles(t, path)
    // Re-read raw to confirm the file landed.
    const raw = await readFile(path, 'utf8')
    expect(JSON.parse(raw).entries[0]).toMatchObject({ path: 'only' })
  })

  it('loadRecentFiles returns empty tracker when file is missing', async () => {
    const t = await loadRecentFiles(join(dir, 'does-not-exist.json'))
    expect(t.list()).toEqual([])
  })

  it('loadRecentFiles tolerates corrupt JSON', async () => {
    const path = join(dir, 'corrupt.json')
    await writeFile(path, '{ not valid json ::::', 'utf8')
    const t = await loadRecentFiles(path)
    expect(t.list()).toEqual([])
  })

  it('loadRecentFiles tolerates wrong-shape JSON', async () => {
    const path = join(dir, 'wrong.json')
    await writeFile(path, JSON.stringify({ hello: 'world' }), 'utf8')
    const t = await loadRecentFiles(path)
    expect(t.list()).toEqual([])
  })

  it('defaultRecentFilesPath ends with .nuka/recent-files.json', () => {
    expect(defaultRecentFilesPath()).toMatch(
      /\.nuka[\\/]recent-files\.json$/,
    )
  })
})

describe('createPersistentRecentFiles', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nuka-recent-persist-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('loads from disk and persists subsequent touches', async () => {
    const path = join(dir, 'state.json')
    // First session: write some state.
    const first = await createPersistentRecentFiles({ path })
    first.touch('a', 100)
    first.touch('b', 200)
    await first.flush()
    // Confirm the disk file has it.
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as { entries: Array<{ path: string }> }
    expect(parsed.entries.map(e => e.path)).toEqual(['a', 'b'])

    // Second session: should restore.
    const second = await createPersistentRecentFiles({ path })
    expect(second.list()).toEqual(['b', 'a'])
    second.touch('c', 300)
    await second.flush()

    // Third session sees all three.
    const third = await createPersistentRecentFiles({ path })
    expect(third.list()).toEqual(['c', 'b', 'a'])
  })

  it('flush completes even with no pending writes', async () => {
    const path = join(dir, 'state.json')
    const t = await createPersistentRecentFiles({ path })
    await expect(t.flush()).resolves.toBeUndefined()
  })

  it('coalesces rapid sequential touches into a consistent final state', async () => {
    const path = join(dir, 'state.json')
    const t = await createPersistentRecentFiles({ path })
    // Fire many touches without awaiting each — the throttle should
    // coalesce them and the final on-disk state should reflect the
    // last touch order.
    for (let i = 0; i < 50; i++) {
      t.touch(`p${i}`, 1000 + i)
    }
    await t.flush()
    const reloaded = await loadRecentFiles(path)
    const list = reloaded.list()
    expect(list[0]).toBe('p49')
    expect(list[list.length - 1]).toBe('p0')
    expect(list.length).toBe(50)
  })

  it('forget / clear are also persisted', async () => {
    const path = join(dir, 'state.json')
    const t = await createPersistentRecentFiles({ path })
    t.touch('a', 1)
    t.touch('b', 2)
    await t.flush()

    t.forget('a')
    await t.flush()
    expect((await loadRecentFiles(path)).list()).toEqual(['b'])

    t.clear()
    await t.flush()
    expect((await loadRecentFiles(path)).list()).toEqual([])
  })
})
