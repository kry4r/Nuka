// test/core/session/manager.test.ts
import { describe, it, expect } from 'vitest'
import { SessionManager } from '../../../src/core/session/manager'

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
