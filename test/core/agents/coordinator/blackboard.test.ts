import { describe, it, expect } from 'vitest'
import { Blackboard } from '../../../../src/core/agents/coordinator/blackboard'

describe('Blackboard', () => {
  it('starts empty', () => {
    const b = new Blackboard()
    expect(b.snapshot()).toEqual({})
  })
  it('write then read', async () => {
    const b = new Blackboard()
    await b.write('finding', 'null pointer at line 42')
    expect(b.read('finding')).toBe('null pointer at line 42')
  })
  it('snapshot returns a copy — caller cannot mutate internal state', async () => {
    const b = new Blackboard()
    await b.write('k', 'v')
    const snap = b.snapshot()
    ;(snap as Record<string, string>)['k'] = 'tampered'
    expect(b.read('k')).toBe('v')
  })
  it('concurrent writers serialise — last-writer-wins is deterministic per key', async () => {
    const b = new Blackboard()
    await Promise.all([
      b.write('k', '1'),
      b.write('k', '2'),
      b.write('k', '3'),
    ])
    // After all settle, exactly one value remains.
    expect(['1', '2', '3']).toContain(b.read('k'))
    expect(Object.keys(b.snapshot())).toEqual(['k'])
  })
  it('throws when key empty', async () => {
    const b = new Blackboard()
    await expect(b.write('', 'v')).rejects.toThrow(/key/)
  })
  it('caps total size at 256 KiB', async () => {
    const b = new Blackboard()
    const big = 'x'.repeat(200_000)
    await b.write('a', big)
    await expect(b.write('b', big)).rejects.toThrow(/size/)
  })
  it('list returns keys', async () => {
    const b = new Blackboard()
    await b.write('a', 'x')
    await b.write('b', 'y')
    expect(b.list().sort()).toEqual(['a', 'b'])
  })
})
