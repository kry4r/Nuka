// test/core/session/session.test.ts
import { describe, it, expect } from 'vitest'
import { createSession, branchSession } from '../../../src/core/session/session'

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
})
