// test/core/worktree/store.test.ts
import { describe, expect, it } from 'vitest'
import {
  createWorktreeStore,
  WorktreeStore,
} from '../../../src/core/worktree/store'

describe('WorktreeStore', () => {
  it('add returns a record with an 8-hex id', () => {
    const store = createWorktreeStore()
    const r = store.add({ path: '/tmp/wt', originalCwd: '/repo' })
    expect(r.id).toMatch(/^[0-9a-f]{8}$/)
    expect(r.path).toBe('/tmp/wt')
    expect(r.originalCwd).toBe('/repo')
    expect(store.size()).toBe(1)
  })

  it('list returns every registered worktree', () => {
    const store = createWorktreeStore()
    store.add({ path: '/a', originalCwd: '/r' })
    store.add({ path: '/b', originalCwd: '/r', branch: 'feat' })
    const all = store.list()
    expect(all).toHaveLength(2)
    expect(all.map((w) => w.path).sort()).toEqual(['/a', '/b'])
  })

  it('getByPath returns the matching record', () => {
    const store = createWorktreeStore()
    const w = store.add({ path: '/repo/.nuka/worktrees/x', originalCwd: '/repo' })
    expect(store.getByPath('/repo/.nuka/worktrees/x')?.id).toBe(w.id)
    expect(store.getByPath('/nope')).toBeUndefined()
  })

  it('remove unregisters by id', () => {
    const store = createWorktreeStore()
    const w = store.add({ path: '/x', originalCwd: '/r' })
    expect(store.remove(w.id)).toBe(true)
    expect(store.size()).toBe(0)
    expect(store.remove(w.id)).toBe(false)
  })

  it('clear empties the registry', () => {
    const store = createWorktreeStore()
    store.add({ path: '/a', originalCwd: '/r' })
    store.add({ path: '/b', originalCwd: '/r' })
    store.clear()
    expect(store.size()).toBe(0)
  })

  it('exposes a MAX_WORKTREES constant', () => {
    expect(WorktreeStore.MAX_WORKTREES).toBeGreaterThan(0)
  })
})
