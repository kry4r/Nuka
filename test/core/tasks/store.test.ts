// test/core/tasks/store.test.ts
import { describe, expect, it } from 'vitest'
import {
  __resetTaskStoreSingletonForTests,
  TaskStore,
  createTaskStore,
  getTaskStore,
  randomTaskId,
} from '../../../src/core/tasks/store'

describe('TaskStore.add', () => {
  it('assigns sequential numeric IDs starting at 1', () => {
    const s = createTaskStore()
    const a = s.add({ subject: 'a', description: 'aa' })
    const b = s.add({ subject: 'b', description: 'bb' })
    expect(a.id).toBe('1')
    expect(b.id).toBe('2')
    expect(a.status).toBe('pending')
    expect(b.status).toBe('pending')
  })

  it('honors explicit id and bumps the seq counter past it', () => {
    const s = createTaskStore()
    const a = s.add({ subject: 'a', description: 'aa', id: '7' })
    const b = s.add({ subject: 'b', description: 'bb' })
    expect(a.id).toBe('7')
    expect(b.id).toBe('8')
  })

  it('rejects duplicate explicit IDs', () => {
    const s = createTaskStore()
    s.add({ subject: 'a', description: 'aa', id: '1' })
    expect(() =>
      s.add({ subject: 'b', description: 'bb', id: '1' }),
    ).toThrow(/duplicate id/)
  })

  it('refuses to exceed MAX_TASKS', () => {
    const s = createTaskStore()
    for (let i = 0; i < TaskStore.MAX_TASKS; i++) {
      s.add({ subject: `t${i}`, description: 'x' })
    }
    expect(() =>
      s.add({ subject: 'overflow', description: 'x' }),
    ).toThrow(/too many/i)
  })
})

describe('TaskStore.update', () => {
  it('returns undefined for unknown IDs', () => {
    const s = createTaskStore()
    expect(s.update('nope', { status: 'completed' })).toBeUndefined()
  })

  it('updates status, subject, description', () => {
    const s = createTaskStore()
    const t = s.add({ subject: 'a', description: 'aa' })
    const u = s.update(t.id, {
      status: 'in_progress',
      subject: 'A!',
      description: 'AA!',
    })
    expect(u?.status).toBe('in_progress')
    expect(u?.subject).toBe('A!')
    expect(u?.description).toBe('AA!')
    expect(u?.updatedAt).toBeGreaterThanOrEqual(t.createdAt)
  })

  it('clears owner when owner=null and sets when string', () => {
    const s = createTaskStore()
    const t = s.add({ subject: 'a', description: 'aa', owner: 'alice' })
    const r1 = s.update(t.id, { owner: 'bob' })
    expect(r1?.owner).toBe('bob')
    const r2 = s.update(t.id, { owner: null })
    expect(r2?.owner).toBeUndefined()
  })

  it('appends addBlocks/addBlockedBy without duplicates and updates symmetric side', () => {
    const s = createTaskStore()
    const a = s.add({ subject: 'a', description: 'aa' })
    const b = s.add({ subject: 'b', description: 'bb' })
    const c = s.add({ subject: 'c', description: 'cc' })

    s.update(a.id, { addBlocks: [b.id, c.id] })
    // Re-applying is idempotent.
    s.update(a.id, { addBlocks: [b.id] })

    expect(s.get(a.id)!.blocks).toEqual([b.id, c.id])
    expect(s.get(b.id)!.blockedBy).toEqual([a.id])
    expect(s.get(c.id)!.blockedBy).toEqual([a.id])
  })

  it('addBlockedBy mirrors to the other task\'s blocks', () => {
    const s = createTaskStore()
    const a = s.add({ subject: 'a', description: 'aa' })
    const b = s.add({ subject: 'b', description: 'bb' })
    s.update(a.id, { addBlockedBy: [b.id] })
    expect(s.get(a.id)!.blockedBy).toEqual([b.id])
    expect(s.get(b.id)!.blocks).toEqual([a.id])
  })

  it('drops dangling references to non-existent IDs', () => {
    const s = createTaskStore()
    const a = s.add({ subject: 'a', description: 'aa' })
    s.update(a.id, { addBlocks: ['999'] })
    expect(s.get(a.id)!.blocks).toEqual([])
  })

  it('does not allow self-blocking', () => {
    const s = createTaskStore()
    const a = s.add({ subject: 'a', description: 'aa' })
    s.update(a.id, { addBlocks: [a.id], addBlockedBy: [a.id] })
    expect(s.get(a.id)!.blocks).toEqual([])
    expect(s.get(a.id)!.blockedBy).toEqual([])
  })

  it('merges metadata patches with null delete semantics', () => {
    const s = createTaskStore()
    const a = s.add({
      subject: 'a',
      description: 'aa',
      metadata: { kept: 1, removeMe: 'x' },
    })
    const r = s.update(a.id, {
      metadata: { kept: 1, removeMe: null, added: true },
    })
    expect(r?.metadata).toEqual({ kept: 1, added: true })
  })
})

describe('TaskStore.remove', () => {
  it('removes the task and prunes cross-edges', () => {
    const s = createTaskStore()
    const a = s.add({ subject: 'a', description: 'aa' })
    const b = s.add({ subject: 'b', description: 'bb' })
    s.update(a.id, { addBlocks: [b.id] })
    expect(s.remove(a.id)).toBe(true)
    expect(s.get(a.id)).toBeUndefined()
    expect(s.get(b.id)!.blockedBy).toEqual([])
  })

  it('returns false for unknown id', () => {
    const s = createTaskStore()
    expect(s.remove('999')).toBe(false)
  })
})

describe('TaskStore singleton', () => {
  it('shares a singleton via getTaskStore', () => {
    __resetTaskStoreSingletonForTests()
    const a = getTaskStore()
    const b = getTaskStore()
    expect(a).toBe(b)
  })

  it('createTaskStore produces fresh instances', () => {
    __resetTaskStoreSingletonForTests()
    expect(createTaskStore()).not.toBe(createTaskStore())
  })
})

describe('randomTaskId', () => {
  it('returns an 8-char hex-ish string', () => {
    const id = randomTaskId()
    expect(id).toMatch(/^[a-f0-9]{8}$/)
  })
})
