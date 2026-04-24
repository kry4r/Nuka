import { describe, it, expect } from 'vitest'
import { LruMap, configHash } from '../../../src/core/mcp/lruCache'

describe('LruMap', () => {
  it('starts empty', () => {
    const m = new LruMap<string, number>(4)
    expect(m.size()).toBe(0)
    expect(m.get('x')).toBeUndefined()
  })

  it('throws RangeError for max < 1', () => {
    expect(() => new LruMap(0)).toThrow(RangeError)
    expect(() => new LruMap(-1)).toThrow(RangeError)
  })

  it('stores and retrieves values', () => {
    const m = new LruMap<string, string>(4)
    m.set('a', 'A')
    expect(m.get('a')).toBe('A')
  })

  it('evicts oldest entry when capacity is exceeded', () => {
    const m = new LruMap<string, number>(2)
    m.set('a', 1)
    m.set('b', 2)
    m.set('c', 3) // should evict 'a'
    expect(m.size()).toBe(2)
    expect(m.get('a')).toBeUndefined()
    expect(m.get('b')).toBe(2)
    expect(m.get('c')).toBe(3)
  })

  it('get() promotes an entry to most-recent, protecting it from eviction', () => {
    const m = new LruMap<string, number>(2)
    m.set('a', 1)
    m.set('b', 2)
    // Access 'a' to promote it
    m.get('a')
    // Now 'b' is the oldest; adding 'c' should evict 'b', not 'a'.
    m.set('c', 3)
    expect(m.get('a')).toBe(1)
    expect(m.get('b')).toBeUndefined()
    expect(m.get('c')).toBe(3)
  })

  it('delete() removes an entry', () => {
    const m = new LruMap<string, number>(4)
    m.set('a', 1)
    m.delete('a')
    expect(m.get('a')).toBeUndefined()
    expect(m.size()).toBe(0)
  })

  it('delete() on absent key is a no-op', () => {
    const m = new LruMap<string, number>(4)
    expect(() => m.delete('missing')).not.toThrow()
  })

  it('clear() removes all entries', () => {
    const m = new LruMap<string, number>(4)
    m.set('a', 1)
    m.set('b', 2)
    m.clear()
    expect(m.size()).toBe(0)
    expect(m.get('a')).toBeUndefined()
  })

  it('size() reflects actual entry count', () => {
    const m = new LruMap<string, number>(4)
    expect(m.size()).toBe(0)
    m.set('a', 1)
    expect(m.size()).toBe(1)
    m.set('b', 2)
    expect(m.size()).toBe(2)
    m.delete('a')
    expect(m.size()).toBe(1)
  })

  it('keys() iterates in oldest-first order', () => {
    const m = new LruMap<string, number>(4)
    m.set('a', 1)
    m.set('b', 2)
    m.set('c', 3)
    expect([...m.keys()]).toEqual(['a', 'b', 'c'])
  })

  it('LruMap(2) with 3 sequential writes evicts oldest', () => {
    // Acceptance criterion from the plan
    const m = new LruMap<string, number>(2)
    m.set('one', 1)
    m.set('two', 2)
    m.set('three', 3)
    expect(m.get('one')).toBeUndefined()   // evicted
    expect(m.get('two')).toBe(2)
    expect(m.get('three')).toBe(3)
    expect(m.size()).toBe(2)
  })

  it('updating an existing key does not grow size beyond max', () => {
    const m = new LruMap<string, number>(2)
    m.set('a', 1)
    m.set('b', 2)
    m.set('a', 99) // update in-place
    expect(m.size()).toBe(2)
    expect(m.get('a')).toBe(99)
    expect(m.get('b')).toBe(2)
  })
})

describe('configHash', () => {
  it('returns an 8-character hex string', () => {
    const h = configHash({ type: 'stdio', command: 'node' })
    expect(h).toMatch(/^[0-9a-f]{8}$/)
  })

  it('returns the same hash for equal configs', () => {
    const cfg = { type: 'stdio', command: 'node', args: [] }
    expect(configHash(cfg)).toBe(configHash(cfg))
    expect(configHash({ a: 1, b: 2 })).toBe(configHash({ a: 1, b: 2 }))
  })

  it('returns different hashes for different configs', () => {
    const h1 = configHash({ command: 'node' })
    const h2 = configHash({ command: 'python' })
    expect(h1).not.toBe(h2)
  })
})
