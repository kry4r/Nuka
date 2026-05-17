// test/core/worktree/store.test.ts
import { describe, expect, it } from 'vitest'
import {
  createWorktreeStore,
  WorktreeStore,
  resolveToolCwd,
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

  // P1 #6 — active pointer + cwd resolution
  describe('active pointer (P1 #6)', () => {
    it('getActive returns undefined when nothing is set', () => {
      const store = createWorktreeStore()
      store.add({ path: '/a', originalCwd: '/r' })
      expect(store.getActive()).toBeUndefined()
    })

    it('setActive marks the record returned by getActive', () => {
      const store = createWorktreeStore()
      const w = store.add({ path: '/a', originalCwd: '/r', branch: 'feat' })
      expect(store.setActive(w.id)).toBe(true)
      expect(store.getActive()?.id).toBe(w.id)
      expect(store.getActive()?.path).toBe('/a')
    })

    it('setActive refuses unknown ids and leaves active untouched', () => {
      const store = createWorktreeStore()
      const w = store.add({ path: '/a', originalCwd: '/r' })
      store.setActive(w.id)
      expect(store.setActive('deadbeef')).toBe(false)
      expect(store.getActive()?.id).toBe(w.id)
    })

    it('clearActive drops the pointer without removing records', () => {
      const store = createWorktreeStore()
      const w = store.add({ path: '/a', originalCwd: '/r' })
      store.setActive(w.id)
      store.clearActive()
      expect(store.getActive()).toBeUndefined()
      expect(store.size()).toBe(1)
    })

    it('remove(activeId) clears the active pointer', () => {
      const store = createWorktreeStore()
      const w = store.add({ path: '/a', originalCwd: '/r' })
      store.setActive(w.id)
      expect(store.remove(w.id)).toBe(true)
      expect(store.getActive()).toBeUndefined()
    })

    it('remove(other-id) does NOT touch the active pointer', () => {
      const store = createWorktreeStore()
      const a = store.add({ path: '/a', originalCwd: '/r' })
      const b = store.add({ path: '/b', originalCwd: '/r' })
      store.setActive(a.id)
      store.remove(b.id)
      expect(store.getActive()?.id).toBe(a.id)
    })

    it('clear() drops both records and the active pointer', () => {
      const store = createWorktreeStore()
      const w = store.add({ path: '/a', originalCwd: '/r' })
      store.setActive(w.id)
      store.clear()
      expect(store.getActive()).toBeUndefined()
      expect(store.size()).toBe(0)
    })
  })

  describe('resolveToolCwd (P1 #6)', () => {
    it('returns fallback when store is undefined', () => {
      expect(resolveToolCwd(undefined, '/fallback')).toBe('/fallback')
    })

    it('returns fallback when store has no active record', () => {
      const store = createWorktreeStore()
      store.add({ path: '/a', originalCwd: '/r' })
      expect(resolveToolCwd(store, '/fallback')).toBe('/fallback')
    })

    it('returns active worktree path when set', () => {
      const store = createWorktreeStore()
      const w = store.add({ path: '/wt', originalCwd: '/r' })
      store.setActive(w.id)
      expect(resolveToolCwd(store, '/fallback')).toBe('/wt')
    })

    it('falls back after the active worktree is removed', () => {
      const store = createWorktreeStore()
      const w = store.add({ path: '/wt', originalCwd: '/r' })
      store.setActive(w.id)
      store.remove(w.id)
      expect(resolveToolCwd(store, '/fallback')).toBe('/fallback')
    })
  })
})
