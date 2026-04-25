// test/core/stats/chart.test.ts
import { describe, it, expect } from 'vitest'
import { chart } from '../../../src/core/stats/chart'
import type { ModelStats } from '../../../src/core/stats/aggregate'

function makeMap(entries: [string, ModelStats][]): Map<string, ModelStats> {
  return new Map(entries)
}

describe('chart()', () => {
  it('returns "(no data yet)" for an empty map', () => {
    const lines = chart(new Map())
    expect(lines).toEqual(['(no data yet)'])
  })

  it('returns one line per model', () => {
    const m = makeMap([
      ['claude-opus-4-7',   { tokens: 2_000_000, usd: 9.20 }],
      ['claude-sonnet-4-6', { tokens: 800_000,   usd: 2.40 }],
      ['gpt-4o',            { tokens: 300_000,   usd: 0.81 }],
    ])
    const lines = chart(m, 72)
    expect(lines).toHaveLength(3)
  })

  it('sorts by tokens descending', () => {
    const m = makeMap([
      ['small-model', { tokens: 100,       usd: 0.01 }],
      ['big-model',   { tokens: 1_000_000, usd: 5.00 }],
    ])
    const lines = chart(m, 60)
    expect(lines[0]).toContain('big-model')
    expect(lines[1]).toContain('small-model')
  })

  it('the top model has the widest bar', () => {
    const m = makeMap([
      ['alpha', { tokens: 1000, usd: 1.0 }],
      ['beta',  { tokens: 500,  usd: 0.5 }],
    ])
    const lines = chart(m, 60)
    const countBars = (s: string) => (s.match(/█/g) ?? []).length
    expect(countBars(lines[0]!)).toBeGreaterThanOrEqual(countBars(lines[1]!))
  })

  it('a single model gets a full bar', () => {
    const m = makeMap([['only-model', { tokens: 500_000, usd: 1.50 }]])
    const lines = chart(m, 60)
    expect(lines[0]).toContain('█')
  })

  it('includes token count in each line', () => {
    const m = makeMap([['gpt-4o', { tokens: 300_000, usd: 0.81 }]])
    const lines = chart(m, 72)
    expect(lines[0]).toContain('300k')
  })

  it('includes USD in each line', () => {
    const m = makeMap([['gpt-4o', { tokens: 1000, usd: 9.99 }]])
    const lines = chart(m, 72)
    expect(lines[0]).toContain('$9.99')
  })
})
