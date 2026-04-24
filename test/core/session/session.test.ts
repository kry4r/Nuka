// test/core/session/session.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createSession, branchSession, appendMessage } from '../../../src/core/session/session'
import { PermissionCache } from '../../../src/core/permission/cache'
import type { Message } from '../../../src/core/message/types'

describe('session factory', () => {
  it('createSession initializes messages empty with given provider/model', () => {
    const s = createSession({ providerId: 'p1', model: 'x' })
    expect(s.providerId).toBe('p1')
    expect(s.model).toBe('x')
    expect(s.messages).toEqual([])
    expect(s.totalUsage).toEqual({ inputTokens: 0, outputTokens: 0 })
    expect(s.mode).toBe('normal')
    expect(s.parentId).toBeUndefined()
  })

  it('createSession gives each session its own PermissionCache instance', () => {
    const s = createSession({ providerId: 'p1', model: 'x' })
    expect(s.permissionCache).toBeInstanceOf(PermissionCache)
    expect(s.permissionCache.list()).toHaveLength(0)
  })

  it('branchSession deep-clones messages and links parentId', () => {
    const parent = createSession({ providerId: 'p1', model: 'x' })
    parent.messages.push({
      role: 'user',
      id: 'u1',
      ts: 1,
      content: [{ type: 'text', text: 'hi' }],
    })
    const child = branchSession(parent)
    expect(child.parentId).toBe(parent.id)
    expect(child.messages).toHaveLength(1)
    // mutating child should not affect parent
    child.messages.push({ role: 'user', id: 'u2', ts: 2, content: [] })
    expect(parent.messages).toHaveLength(1)
  })

  it('branchSession copies parent permission rules into a fresh child cache', () => {
    const parent = createSession({ providerId: 'p1', model: 'x' })
    parent.permissionCache.add({ scope: 'session', hint: 'write' })
    const child = branchSession(parent)
    expect(child.permissionCache).toBeInstanceOf(PermissionCache)
    expect(child.permissionCache).not.toBe(parent.permissionCache)
    expect(child.permissionCache.list()).toHaveLength(1)
    expect(child.permissionCache.list()[0]).toEqual({ scope: 'session', hint: 'write' })
    // adding to child does not affect parent
    child.permissionCache.add({ scope: 'session', hint: 'exec' })
    expect(parent.permissionCache.list()).toHaveLength(1)
  })
})

describe('appendMessage', () => {
  it('pushes msg to session.messages, bumps updatedAt, and calls sink with session + msg', () => {
    const session = createSession({ providerId: 'p1', model: 'x' })
    const before = session.updatedAt
    const msg: Message = { role: 'user', id: 'u1', ts: Date.now(), content: [{ type: 'text', text: 'hi' }] }
    const sink = vi.fn()

    appendMessage(session, msg, sink)

    expect(session.messages).toHaveLength(1)
    expect(session.messages[0]).toBe(msg)
    expect(session.updatedAt).toBeGreaterThanOrEqual(before)
    expect(sink).toHaveBeenCalledOnce()
    expect(sink).toHaveBeenCalledWith(session, msg)
  })

  it('works without a sink', () => {
    const session = createSession({ providerId: 'p1', model: 'x' })
    const msg: Message = { role: 'user', id: 'u2', ts: Date.now(), content: [] }
    expect(() => appendMessage(session, msg)).not.toThrow()
    expect(session.messages).toHaveLength(1)
  })
})
