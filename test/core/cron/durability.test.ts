// test/core/cron/durability.test.ts
//
// Durable-mode tests for {@link CronStore}.
// Covers:
//   - durable=false on a non-durable store: no file touched
//   - durable=true on a durable store: file appears with expected shape
//   - atomic write (tmp -> rename), tmp file removed
//   - rehydrate restores jobs into a fresh store
//   - corrupted JSON -> empty store (no throw)
//   - delete on durable store updates the file
//   - mixing durable + session tasks: only the durable subset hits disk
//   - tool layer: CronCreate { durable: true } against non-durable store errors

import { mkdtemp, mkdir, readdir, readFile, rm, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { loadPersistedCronJobs, readCronFile, writeCronFile } from '../../../src/core/cron/persist'
import { createCronStore } from '../../../src/core/cron/store'
import { makeCronCreateTool, makeCronDeleteTool } from '../../../src/core/cron/tools'

const ctx = { signal: new AbortController().signal, cwd: process.cwd() }

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

describe('CronStore durability — direct API', () => {
  let dir: string
  let cronPath: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'nuka-cron-'))
    cronPath = path.join(dir, '.nuka', 'scheduled_tasks.json')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('non-durable store never touches the filesystem', async () => {
    const store = createCronStore()
    expect(store.isDurable()).toBe(false)
    store.add({ cron: '0 9 * * *', prompt: 'p', recurring: true })
    await store.flush()
    expect(await fileExists(cronPath)).toBe(false)
  })

  it('durable store with durable=false task does not write the file', async () => {
    const store = createCronStore({ persistPath: cronPath })
    expect(store.isDurable()).toBe(true)
    store.add({ cron: '0 9 * * *', prompt: 'session', recurring: true, durable: false })
    await store.flush()
    expect(await fileExists(cronPath)).toBe(false)
  })

  it('durable store with durable=true writes the expected JSON shape', async () => {
    const store = createCronStore({ persistPath: cronPath })
    store.add({
      cron: '0 9 * * *',
      prompt: 'morning checkin',
      recurring: true,
      durable: true,
      now: 1_700_000_000_000,
    })
    await store.flush()
    const raw = await readFile(cronPath, 'utf8')
    const parsed = JSON.parse(raw)
    expect(parsed.version).toBe(1)
    expect(Array.isArray(parsed.tasks)).toBe(true)
    expect(parsed.tasks).toHaveLength(1)
    const [task] = parsed.tasks
    expect(task.cron).toBe('0 9 * * *')
    expect(task.prompt).toBe('morning checkin')
    expect(task.recurring).toBe(true)
    expect(task.createdAt).toBe(1_700_000_000_000)
    expect(typeof task.id).toBe('string')
    expect(task.id).toMatch(/^[0-9a-f]{8}$/)
  })

  it('refuses durable=true on a non-durable store', () => {
    const store = createCronStore()
    expect(() =>
      store.add({ cron: '0 9 * * *', prompt: 'p', recurring: true, durable: true }),
    ).toThrowError(/persistPath/)
  })

  it('mixes durable and session tasks — only durable subset on disk', async () => {
    const store = createCronStore({ persistPath: cronPath })
    store.add({ cron: '0 9 * * *', prompt: 'durable A', recurring: true, durable: true })
    store.add({ cron: '0 10 * * *', prompt: 'session B', recurring: true, durable: false })
    store.add({ cron: '0 11 * * *', prompt: 'durable C', recurring: false, durable: true })
    await store.flush()
    const onDisk = await readCronFile(cronPath)
    expect(onDisk).toHaveLength(2)
    const prompts = onDisk.map((t) => t.prompt).sort()
    expect(prompts).toEqual(['durable A', 'durable C'])
    // In-memory still has all three.
    expect(store.size()).toBe(3)
  })

  it('atomic write: leaves no .tmp files behind', async () => {
    const store = createCronStore({ persistPath: cronPath })
    for (let i = 0; i < 5; i++) {
      store.add({
        cron: '0 9 * * *',
        prompt: `t${i}`,
        recurring: true,
        durable: true,
      })
    }
    await store.flush()
    const entries = await readdir(path.dirname(cronPath))
    const tmpLeftovers = entries.filter((e) => e.includes('.tmp-'))
    expect(tmpLeftovers).toEqual([])
    expect(entries).toContain(path.basename(cronPath))
  })

  it('serialises concurrent writes — final file reflects last state', async () => {
    const store = createCronStore({ persistPath: cronPath })
    store.add({ cron: '0 9 * * *', prompt: 'a', recurring: true, durable: true })
    store.add({ cron: '0 10 * * *', prompt: 'b', recurring: true, durable: true })
    store.add({ cron: '0 11 * * *', prompt: 'c', recurring: true, durable: true })
    await store.flush()
    const onDisk = await readCronFile(cronPath)
    expect(onDisk).toHaveLength(3)
  })

  it('delete on durable task updates the file', async () => {
    const store = createCronStore({ persistPath: cronPath })
    const a = store.add({ cron: '0 9 * * *', prompt: 'a', recurring: true, durable: true })
    store.add({ cron: '0 10 * * *', prompt: 'b', recurring: true, durable: true })
    await store.flush()
    expect((await readCronFile(cronPath))).toHaveLength(2)

    store.remove(a.id)
    await store.flush()
    const onDisk = await readCronFile(cronPath)
    expect(onDisk).toHaveLength(1)
    expect(onDisk[0]!.prompt).toBe('b')
  })

  it('delete on session-only task does NOT write the file', async () => {
    const store = createCronStore({ persistPath: cronPath })
    const a = store.add({ cron: '0 9 * * *', prompt: 'session', recurring: true, durable: false })
    await store.flush()
    expect(await fileExists(cronPath)).toBe(false)
    store.remove(a.id)
    await store.flush()
    expect(await fileExists(cronPath)).toBe(false)
  })

  it('clear() rewrites the file when durable tasks existed', async () => {
    const store = createCronStore({ persistPath: cronPath })
    store.add({ cron: '0 9 * * *', prompt: 'a', recurring: true, durable: true })
    await store.flush()
    expect((await readCronFile(cronPath))).toHaveLength(1)
    store.clear()
    await store.flush()
    const onDisk = await readCronFile(cronPath)
    expect(onDisk).toEqual([])
  })
})

describe('readCronFile / loadPersistedCronJobs', () => {
  let dir: string
  let cronPath: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'nuka-cron-load-'))
    cronPath = path.join(dir, '.nuka', 'scheduled_tasks.json')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('missing file returns empty list (no throw)', async () => {
    expect(await readCronFile(cronPath)).toEqual([])
    expect(await loadPersistedCronJobs(cronPath)).toEqual([])
  })

  it('corrupted JSON returns empty list (no throw)', async () => {
    await mkdir(path.dirname(cronPath), { recursive: true })
    await writeFile(cronPath, '{not valid json', 'utf8')
    expect(await readCronFile(cronPath)).toEqual([])
    expect(await loadPersistedCronJobs(cronPath)).toEqual([])
  })

  it('unknown schema version returns empty list', async () => {
    await mkdir(path.dirname(cronPath), { recursive: true })
    await writeFile(
      cronPath,
      JSON.stringify({ version: 999, tasks: [{ id: 'x', cron: '0 9 * * *', prompt: 'p', createdAt: 1, recurring: true }] }),
      'utf8',
    )
    expect(await readCronFile(cronPath)).toEqual([])
  })

  it('drops malformed task entries but keeps valid neighbours', async () => {
    await mkdir(path.dirname(cronPath), { recursive: true })
    await writeFile(
      cronPath,
      JSON.stringify({
        version: 1,
        tasks: [
          { id: 'aaaa1111', cron: '0 9 * * *', prompt: 'good', createdAt: 1, recurring: true },
          { id: 'bbbb2222', cron: 'not-a-cron', prompt: 'bad cron', createdAt: 2, recurring: false },
          { id: 'cccc3333', prompt: 'missing cron', createdAt: 3, recurring: false }, // no cron
          'string-not-object',
          null,
          { id: 'dddd4444', cron: '0 10 * * *', prompt: 'fine', createdAt: 4, recurring: false },
        ],
      }),
      'utf8',
    )
    const tasks = await readCronFile(cronPath)
    expect(tasks).toHaveLength(2)
    expect(tasks.map((t) => t.id).sort()).toEqual(['aaaa1111', 'dddd4444'])
  })

  it('drops unknown forward-compat keys on read', async () => {
    await mkdir(path.dirname(cronPath), { recursive: true })
    await writeFile(
      cronPath,
      JSON.stringify({
        version: 1,
        tasks: [
          {
            id: 'aaaa1111',
            cron: '0 9 * * *',
            prompt: 'p',
            createdAt: 1,
            recurring: true,
            futureField: 'should-be-ignored',
            permanent: true,
          },
        ],
      }),
      'utf8',
    )
    const tasks = await readCronFile(cronPath)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).not.toHaveProperty('futureField')
    expect(tasks[0]).not.toHaveProperty('permanent')
  })

  it('round-trips: writeCronFile -> readCronFile preserves data', async () => {
    const input = [
      { id: 'aaaa1111', cron: '0 9 * * *', prompt: 'one', createdAt: 100, recurring: true, durable: true },
      { id: 'bbbb2222', cron: '*/5 * * * *', prompt: 'two', createdAt: 200, recurring: false, durable: true },
    ]
    await writeCronFile(cronPath, input)
    const out = await readCronFile(cronPath)
    expect(out).toHaveLength(2)
    expect(out.map((t) => t.id).sort()).toEqual(['aaaa1111', 'bbbb2222'])
    // durable flag is reconstructed on hydrate, not stored on disk.
    expect(out[0]).not.toHaveProperty('durable')
  })
})

// Iter HHHH: lastFiredAt persistence — optional, additive, no schema bump.
// Old v1 files without the field still load; new files round-trip it.
describe('lastFiredAt persistence (Iter HHHH)', () => {
  let dir: string
  let cronPath: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'nuka-cron-lastfired-'))
    cronPath = path.join(dir, '.nuka', 'scheduled_tasks.json')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('reads an old v1 file without lastFiredAt — field is undefined', async () => {
    await mkdir(path.dirname(cronPath), { recursive: true })
    await writeFile(
      cronPath,
      JSON.stringify({
        version: 1,
        tasks: [
          {
            id: 'old00001',
            cron: '0 9 * * *',
            prompt: 'old style',
            createdAt: 1_700_000_000_000,
            recurring: true,
            // No lastFiredAt — this is what pre-HHHH files look like.
          },
        ],
      }),
      'utf8',
    )
    const tasks = await readCronFile(cronPath)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.lastFiredAt).toBeUndefined()
    // Old file shouldn't crash the loader; backward-compat is the
    // whole point of the additive-field choice.
  })

  it('reads a new v1 file with lastFiredAt — field is present', async () => {
    await mkdir(path.dirname(cronPath), { recursive: true })
    await writeFile(
      cronPath,
      JSON.stringify({
        version: 1,
        tasks: [
          {
            id: 'new00001',
            cron: '0 9 * * *',
            prompt: 'has fire history',
            createdAt: 1_700_000_000_000,
            recurring: true,
            lastFiredAt: 1_700_000_300_000,
          },
        ],
      }),
      'utf8',
    )
    const tasks = await readCronFile(cronPath)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.lastFiredAt).toBe(1_700_000_300_000)
  })

  it('writeCronFile -> readCronFile round-trips lastFiredAt', async () => {
    const input = [
      {
        id: 'rt000001',
        cron: '0 9 * * *',
        prompt: 'fired',
        createdAt: 100,
        recurring: true,
        durable: true,
        lastFiredAt: 12_345,
      },
      {
        id: 'rt000002',
        cron: '0 10 * * *',
        prompt: 'never fired',
        createdAt: 200,
        recurring: true,
        durable: true,
        // lastFiredAt omitted — should round-trip as undefined.
      },
    ]
    await writeCronFile(cronPath, input)
    const out = await readCronFile(cronPath)
    expect(out).toHaveLength(2)
    const fired = out.find((t) => t.id === 'rt000001')!
    const fresh = out.find((t) => t.id === 'rt000002')!
    expect(fired.lastFiredAt).toBe(12_345)
    expect(fresh.lastFiredAt).toBeUndefined()
  })

  it('writeCronFile omits lastFiredAt from JSON when undefined (file stays tidy)', async () => {
    const input = [
      {
        id: 'omit0001',
        cron: '0 9 * * *',
        prompt: 'never fired yet',
        createdAt: 100,
        recurring: true,
        durable: true,
      },
    ]
    await writeCronFile(cronPath, input)
    const raw = await readFile(cronPath, 'utf8')
    const parsed = JSON.parse(raw)
    expect(parsed.tasks[0]).not.toHaveProperty('lastFiredAt')
  })

  it('rejects garbage lastFiredAt values gracefully (string, null, NaN)', async () => {
    await mkdir(path.dirname(cronPath), { recursive: true })
    await writeFile(
      cronPath,
      JSON.stringify({
        version: 1,
        tasks: [
          {
            id: 'garbage1',
            cron: '0 9 * * *',
            prompt: 'p',
            createdAt: 1,
            recurring: true,
            lastFiredAt: 'not a number',
          },
          {
            id: 'garbage2',
            cron: '0 9 * * *',
            prompt: 'p',
            createdAt: 2,
            recurring: true,
            lastFiredAt: null,
          },
        ],
      }),
      'utf8',
    )
    const tasks = await readCronFile(cronPath)
    expect(tasks).toHaveLength(2)
    // Garbage in the optional field shouldn't reject the whole row —
    // just treat it as "no fire history yet".
    expect(tasks[0]!.lastFiredAt).toBeUndefined()
    expect(tasks[1]!.lastFiredAt).toBeUndefined()
  })

  it('schema version is unchanged (still 1) after additive change', async () => {
    const store = createCronStore({ persistPath: cronPath })
    store.add({ cron: '0 9 * * *', prompt: 'p', recurring: true, durable: true })
    await store.flush()
    const raw = await readFile(cronPath, 'utf8')
    const parsed = JSON.parse(raw)
    // Additive field; no schema bump needed.
    expect(parsed.version).toBe(1)
  })

  it('updateLastFiredAt mutates the task and flushes to disk', async () => {
    const store = createCronStore({ persistPath: cronPath })
    const task = store.add({
      cron: '0 9 * * *',
      prompt: 'p',
      recurring: true,
      durable: true,
      now: 1_000,
    })
    await store.flush()
    expect(store.updateLastFiredAt(task.id, 5_000)).toBe(true)
    await store.flush()
    const onDisk = await readCronFile(cronPath)
    expect(onDisk).toHaveLength(1)
    expect(onDisk[0]!.lastFiredAt).toBe(5_000)
    // In-memory mirror is consistent with disk.
    expect(store.get(task.id)?.lastFiredAt).toBe(5_000)
  })

  it('updateLastFiredAt on a session-only task does NOT write the file', async () => {
    const store = createCronStore({ persistPath: cronPath })
    const task = store.add({
      cron: '0 9 * * *',
      prompt: 'session',
      recurring: true,
      durable: false,
    })
    await store.flush()
    expect(await fileExists(cronPath)).toBe(false)
    expect(store.updateLastFiredAt(task.id, 5_000)).toBe(true)
    await store.flush()
    // Still no file — session-only tasks don't touch disk.
    expect(await fileExists(cronPath)).toBe(false)
    // But the in-memory anchor advanced.
    expect(store.get(task.id)?.lastFiredAt).toBe(5_000)
  })

  it('updateLastFiredAt returns false for an unknown task id', () => {
    const store = createCronStore()
    expect(store.updateLastFiredAt('does-not-exist', 1234)).toBe(false)
  })

  it('hydrate carries lastFiredAt through to the in-memory task', () => {
    const store = createCronStore()
    store.hydrate([
      {
        id: 'hydrate1',
        cron: '0 9 * * *',
        prompt: 'p',
        createdAt: 100,
        recurring: true,
        lastFiredAt: 999,
      },
      {
        id: 'hydrate2',
        cron: '0 10 * * *',
        prompt: 'fresh',
        createdAt: 200,
        recurring: true,
        // no lastFiredAt — should hydrate as undefined
      },
    ])
    expect(store.get('hydrate1')?.lastFiredAt).toBe(999)
    expect(store.get('hydrate2')?.lastFiredAt).toBeUndefined()
  })

  it('full cycle: write -> read -> hydrate -> update -> flush -> read again', async () => {
    // First session: add, fire (via updateLastFiredAt), persist.
    const s1 = createCronStore({ persistPath: cronPath })
    const t = s1.add({
      cron: '0 9 * * *',
      prompt: 'survives restart',
      recurring: true,
      durable: true,
      now: 1_000,
    })
    s1.updateLastFiredAt(t.id, 2_000)
    await s1.flush()

    // Second session: load + hydrate. The lastFiredAt anchor survives.
    const loaded = await loadPersistedCronJobs(cronPath)
    expect(loaded).toHaveLength(1)
    expect(loaded[0]!.lastFiredAt).toBe(2_000)

    const s2 = createCronStore({ persistPath: cronPath })
    s2.hydrate(loaded)
    expect(s2.get(t.id)?.lastFiredAt).toBe(2_000)

    // Update again in the new session — disk reflects the new value.
    s2.updateLastFiredAt(t.id, 3_000)
    await s2.flush()
    const finalOnDisk = await readCronFile(cronPath)
    expect(finalOnDisk[0]!.lastFiredAt).toBe(3_000)
  })
})

describe('CronStore.hydrate', () => {
  it('rehydrate from disk into a fresh durable store', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'nuka-cron-hydrate-'))
    const cronPath = path.join(dir, '.nuka', 'scheduled_tasks.json')
    try {
      // First session: durable store writes two jobs.
      const s1 = createCronStore({ persistPath: cronPath })
      s1.add({ cron: '0 9 * * *', prompt: 'one', recurring: true, durable: true, now: 1000 })
      s1.add({ cron: '*/5 * * * *', prompt: 'two', recurring: false, durable: true, now: 2000 })
      await s1.flush()

      // Second session: load + hydrate.
      const loaded = await loadPersistedCronJobs(cronPath)
      expect(loaded).toHaveLength(2)
      const s2 = createCronStore({ persistPath: cronPath })
      s2.hydrate(loaded)
      expect(s2.size()).toBe(2)
      const ids = s2.list().map((t) => t.id).sort()
      const origIds = s1.list().map((t) => t.id).sort()
      expect(ids).toEqual(origIds)
      // Hydrated jobs come back marked durable so future mutations re-persist.
      expect(s2.list().every((t) => t.durable)).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('hydrate does not trigger a persist write of its own', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'nuka-cron-hydrate-noop-'))
    const cronPath = path.join(dir, '.nuka', 'scheduled_tasks.json')
    try {
      const store = createCronStore({ persistPath: cronPath })
      // Path doesn't exist yet; hydrate shouldn't create it.
      store.hydrate([
        { id: 'aaaa1111', cron: '0 9 * * *', prompt: 'p', createdAt: 1, recurring: true },
      ])
      await store.flush()
      expect(await fileExists(cronPath)).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('CronCreate tool with durable flag', () => {
  it('errors when durable=true on a non-durable store', async () => {
    const store = createCronStore()
    const tool = makeCronCreateTool(store)
    const r = await tool.run(
      { cron: '0 9 * * *', prompt: 'p', durable: true },
      ctx,
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('Durable scheduling is not enabled')
    expect(store.size()).toBe(0)
  })

  it('writes the file when durable=true on a durable store', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'nuka-cron-tool-'))
    const cronPath = path.join(dir, '.nuka', 'scheduled_tasks.json')
    try {
      const store = createCronStore({ persistPath: cronPath })
      const tool = makeCronCreateTool(store)
      const r = await tool.run(
        { cron: '0 9 * * *', prompt: 'daily', durable: true },
        ctx,
      )
      expect(r.isError).toBe(false)
      expect(r.output).toContain('persisted to disk')
      await store.flush()
      const onDisk = await readCronFile(cronPath)
      expect(onDisk).toHaveLength(1)
      expect(onDisk[0]!.prompt).toBe('daily')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('defaults durable=false on a durable store (session-only)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'nuka-cron-tool-default-'))
    const cronPath = path.join(dir, '.nuka', 'scheduled_tasks.json')
    try {
      const store = createCronStore({ persistPath: cronPath })
      const tool = makeCronCreateTool(store)
      const r = await tool.run({ cron: '0 9 * * *', prompt: 'p' }, ctx)
      expect(r.isError).toBe(false)
      expect(r.output).toContain('session-only')
      await store.flush()
      expect(await fileExists(cronPath)).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('CronDelete on a durable task updates the file', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'nuka-cron-delete-'))
    const cronPath = path.join(dir, '.nuka', 'scheduled_tasks.json')
    try {
      const store = createCronStore({ persistPath: cronPath })
      const create = makeCronCreateTool(store)
      const del = makeCronDeleteTool(store)
      await create.run({ cron: '0 9 * * *', prompt: 'a', durable: true }, ctx)
      await create.run({ cron: '0 10 * * *', prompt: 'b', durable: true }, ctx)
      await store.flush()
      const before = await readCronFile(cronPath)
      expect(before).toHaveLength(2)
      const firstId = before[0]!.id
      const r = await del.run({ id: firstId }, ctx)
      expect(r.isError).toBe(false)
      await store.flush()
      const after = await readCronFile(cronPath)
      expect(after).toHaveLength(1)
      expect(after[0]!.id).not.toBe(firstId)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
