// test/core/session/manager.test.ts
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SessionManager } from '../../../src/core/session/manager'
import { SessionStore, DebouncedMetaWriter } from '../../../src/core/session/store'
import type { Message } from '../../../src/core/message/types'

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'nuka-manager-test-'))
}

describe('SessionManager', () => {
  it('start creates and activates an initial session', () => {
    const m = new SessionManager()
    const s = m.start({ providerId: 'p', model: 'x' })
    expect(m.active()).toBe(s)
    expect(m.list()).toEqual([s])
  })

  it('new() adds a fresh session and makes it active; old session is preserved', () => {
    const m = new SessionManager()
    const a = m.start({ providerId: 'p', model: 'x' })
    const b = m.new()
    expect(m.active()).toBe(b)
    expect(m.list()).toEqual([a, b])
  })

  it('fork() forks active, makes fork active, preserves parent', () => {
    const m = new SessionManager()
    const a = m.start({ providerId: 'p', model: 'x' })
    a.messages.push({ role: 'user', id: 'u', ts: 1, content: [] })
    const b = m.fork()
    expect(b.parentId).toBe(a.id)
    expect(m.active()).toBe(b)
    expect(m.list()).toHaveLength(2)
  })

  it('switch(id) changes active without mutating list order', () => {
    const m = new SessionManager()
    const a = m.start({ providerId: 'p', model: 'x' })
    const b = m.new()
    m.switch(a.id)
    expect(m.active()).toBe(a)
  })
})

describe('SessionManager with store + metaWriter', () => {
  it('persist appends message to store and schedules a meta write', async () => {
    const appendMessage = vi.fn().mockResolvedValue(undefined)
    const schedule = vi.fn()
    const flush = vi.fn().mockResolvedValue(undefined)

    const store = { appendMessage } as unknown as SessionStore
    const metaWriter = { schedule, flush } as unknown as DebouncedMetaWriter

    const m = new SessionManager({ store, metaWriter })
    const session = m.start({ providerId: 'p', model: 'x' })

    // start() already called schedule once
    const callsBefore = schedule.mock.calls.length

    const msg: Message = { role: 'user', id: 'u1', ts: Date.now(), content: [{ type: 'text', text: 'hi' }] }
    m.persist(session, msg)

    // appendMessage is fire-and-forget, give microtasks a tick
    await Promise.resolve()

    expect(appendMessage).toHaveBeenCalledWith(session.id, msg)
    expect(schedule).toHaveBeenCalledTimes(callsBefore + 1)
    expect(schedule).toHaveBeenLastCalledWith(session)
  })

  it('persist does not throw if store.appendMessage rejects', async () => {
    const appendMessage = vi.fn().mockRejectedValue(new Error('disk full'))
    const schedule = vi.fn()
    const store = { appendMessage } as unknown as SessionStore
    const metaWriter = { schedule, flush: vi.fn() } as unknown as DebouncedMetaWriter

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const m = new SessionManager({ store, metaWriter })
    const session = m.start({ providerId: 'p', model: 'x' })
    const msg: Message = { role: 'user', id: 'u2', ts: Date.now(), content: [] }

    expect(() => m.persist(session, msg)).not.toThrow()
    // let the rejected promise settle
    await new Promise(r => setTimeout(r, 10))
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})

describe('SessionManager resume + listPersisted', () => {
  it('round-trip: start → persist → new manager → resume returns session with messages', async () => {
    const dir = await tmpDir()
    const store1 = new SessionStore({ dir })
    const meta1 = new DebouncedMetaWriter(store1, 0)
    const m1 = new SessionManager({ store: store1, metaWriter: meta1 })
    const s = m1.start({ providerId: 'p', model: 'gpt-x' })
    const goal = m1.setGoal(s.id, {
      objective: 'ship a goal store',
      tokenBudget: 20000,
      tokenUsage: 750,
    })
    const msg: Message = { role: 'user', id: 'u1', ts: Date.now(), content: [{ type: 'text', text: 'hello' }] }
    m1.persist(s, msg)
    await meta1.flush()
    // wait for appendMessage fire-and-forget
    await new Promise(r => setTimeout(r, 20))

    const store2 = new SessionStore({ dir })
    const m2 = new SessionManager({ store: store2 })
    const resumed = await m2.resume(s.id)
    expect(resumed.id).toBe(s.id)
    expect(resumed.model).toBe('gpt-x')
    expect(resumed.goal).toEqual(goal)
    expect(resumed.messages).toHaveLength(1)
    expect((resumed.messages[0]!.content[0] as any).text).toBe('hello')
    expect(m2.active()).toBe(resumed)
  })

  it('resume throws on unknown id', async () => {
    const dir = await tmpDir()
    const store = new SessionStore({ dir })
    const m = new SessionManager({ store })
    await expect(m.resume('nonexistent-id')).rejects.toThrow('unknown session: nonexistent-id')
  })

  it('resume throws when no store configured', async () => {
    const m = new SessionManager()
    await expect(m.resume('some-id')).rejects.toThrow('no store — session resume unavailable')
  })

  it('listPersisted returns sorted metas', async () => {
    const dir = await tmpDir()
    const store = new SessionStore({ dir })
    const meta = new DebouncedMetaWriter(store, 0)
    const m = new SessionManager({ store, metaWriter: meta })
    const s1 = m.start({ providerId: 'p', model: 'm1' })
    s1.updatedAt = 1000
    const s2 = m.new()
    s2.updatedAt = 3000
    await meta.flush()
    // flush writes the last pending (s2); also manually write s1 meta
    await store.writeMeta(s1)

    const metas = await m.listPersisted()
    expect(metas).toHaveLength(2)
    expect(metas[0]!.updatedAt).toBeGreaterThanOrEqual(metas[1]!.updatedAt)
  })

  it('listPersisted returns empty array when no store', async () => {
    const m = new SessionManager()
    const metas = await m.listPersisted()
    expect(metas).toEqual([])
  })

  it('forkPersisted copies a stored session into a new active persisted child', async () => {
    const dir = await tmpDir()
    const store1 = new SessionStore({ dir })
    const meta1 = new DebouncedMetaWriter(store1, 0)
    const m1 = new SessionManager({ store: store1, metaWriter: meta1 })
    const source = m1.start({ providerId: 'p', model: 'gpt-x' })
    m1.setGoal(source.id, {
      objective: 'preserve goal across fork',
      status: 'blocked',
      blockedReason: 'waiting on review',
    })
    const msg: Message = {
      role: 'user',
      id: 'u1',
      ts: Date.now(),
      content: [{ type: 'text', text: 'fork me' }],
    }
    m1.persist(source, msg)
    await meta1.flush()
    await new Promise(r => setTimeout(r, 20))

    const store2 = new SessionStore({ dir })
    const meta2 = new DebouncedMetaWriter(store2, 0)
    const m2 = new SessionManager({ store: store2, metaWriter: meta2 })

    const forked = await m2.forkPersisted(source.id)
    await meta2.flush()

    expect(forked.id).not.toBe(source.id)
    expect(forked.parentId).toBe(source.id)
    expect(forked.providerId).toBe('p')
    expect(forked.model).toBe('gpt-x')
    expect(forked.goal).toMatchObject({
      objective: 'preserve goal across fork',
      status: 'blocked',
      blockedReason: 'waiting on review',
    })
    expect(forked.messages).toHaveLength(1)
    expect((forked.messages[0]!.content[0] as any).text).toBe('fork me')
    expect(m2.active()).toBe(forked)

    const persistedFork = await store2.readMessages(forked.id)
    expect(persistedFork).toHaveLength(1)
    expect((persistedFork[0]!.content[0] as any).text).toBe('fork me')
    const forkMeta = await store2.readMeta(forked.id)
    expect(forkMeta?.parentId).toBe(source.id)
    expect(forkMeta?.messageCount).toBe(1)
    expect(forkMeta?.goal?.objective).toBe('preserve goal across fork')
  })

  it('forkPersisted throws without a store', async () => {
    const m = new SessionManager()
    await expect(m.forkPersisted('some-id')).rejects.toThrow('no store — session fork unavailable')
  })

  it('setGoal/getGoal/clearGoal update in-memory session state and persisted meta', async () => {
    const dir = await tmpDir()
    const store = new SessionStore({ dir })
    const meta = new DebouncedMetaWriter(store, 0)
    const m = new SessionManager({ store, metaWriter: meta })
    const session = m.start({ providerId: 'p', model: 'm' })

    const goal = m.setGoal(session.id, {
      objective: 'finish current iteration',
      tokenBudget: 10000,
    })
    await meta.flush()

    expect(goal).toMatchObject({
      objective: 'finish current iteration',
      status: 'active',
      tokenBudget: 10000,
    })
    expect(m.getGoal(session.id)).toEqual(goal)
    expect((await store.readMeta(session.id))?.goal).toEqual(goal)

    const cleared = m.clearGoal(session.id)
    await meta.flush()

    expect(cleared).toEqual(goal)
    expect(m.getGoal(session.id)).toBeNull()
    expect((await store.readMeta(session.id))?.goal).toBeUndefined()
  })
})
