// test/core/session/manager.test.ts
import { describe, it, expect, vi } from 'vitest'
import { SessionManager } from '../../../src/core/session/manager'
import type { SessionStore, DebouncedMetaWriter } from '../../../src/core/session/store'
import type { Message } from '../../../src/core/message/types'

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

  it('branch() forks active, makes fork active, preserves parent', () => {
    const m = new SessionManager()
    const a = m.start({ providerId: 'p', model: 'x' })
    a.messages.push({ role: 'user', id: 'u', ts: 1, content: [] })
    const b = m.branch()
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
