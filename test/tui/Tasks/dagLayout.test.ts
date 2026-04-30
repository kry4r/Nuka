// test/tui/Tasks/dagLayout.test.ts
import { describe, it, expect } from 'vitest'
import { dagLayout } from '../../../src/tui/Tasks/dagLayout'

describe('dagLayout', () => {
  it('places diamond a → b,c → d on 3 levels', () => {
    const out = dagLayout([
      { id: 'a', parents: [] }, { id: 'b', parents: ['a'] },
      { id: 'c', parents: ['a'] }, { id: 'd', parents: ['b', 'c'] },
    ])
    expect(out.find(n => n.id === 'a')!.level).toBe(0)
    expect(out.find(n => n.id === 'b')!.level).toBe(1)
    expect(out.find(n => n.id === 'c')!.level).toBe(1)
    expect(out.find(n => n.id === 'd')!.level).toBe(2)
  })

  it('throws on cycle', () => {
    expect(() => dagLayout([{ id: 'a', parents: ['b'] }, { id: 'b', parents: ['a'] }])).toThrow(/cycle/i)
  })
})
