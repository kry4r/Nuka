// test/core/cost/tracker.test.ts
import { describe, it, expect } from 'vitest'
import { CostTracker } from '../../../src/core/cost/tracker'
import { findPricing, PRICING } from '../../../src/core/cost/pricing'

describe('cost pricing seed', () => {
  it('exports the six required model rows', () => {
    for (const id of [
      'claude-opus-4-7',
      'claude-sonnet-4-6',
      'claude-haiku-4-5',
      'gpt-5',
      'gpt-4o',
      'gpt-4o-mini',
    ]) {
      expect(PRICING[id], `pricing missing for ${id}`).toBeDefined()
      const p = PRICING[id]!
      expect(p.input).toBeGreaterThan(0)
      expect(p.output).toBeGreaterThan(0)
      expect(Number.isFinite(p.input)).toBe(true)
      expect(Number.isFinite(p.output)).toBe(true)
    }
  })

  it('lookup is case-insensitive and tolerates provider prefixes', () => {
    expect(findPricing('Claude-Opus-4-7')).toBeDefined()
    expect(findPricing('anthropic/claude-haiku-4-5')).toBeDefined()
    expect(findPricing('openai/gpt-4o-mini')).toBeDefined()
    expect(findPricing('totally-unknown-model')).toBeUndefined()
    expect(findPricing('')).toBeUndefined()
  })
})

describe('CostTracker', () => {
  it('records a turn and reflects it in `current(sessionId)`', () => {
    const t = new CostTracker()
    t.record('claude-opus-4-7', 's1', { input: 1000, output: 500 })
    const cur = t.current('s1')
    expect(cur.inputTokens).toBe(1000)
    expect(cur.outputTokens).toBe(500)
    expect(cur.turns).toBe(1)
  })

  it('partitions across sessions and across days', () => {
    const t = new CostTracker()
    const today = Date.now()
    const yesterday = today - 26 * 3600 * 1000
    t.record('claude-haiku-4-5', 's1', { input: 100, output: 50 }, today)
    t.record('claude-haiku-4-5', 's2', { input: 200, output: 80 }, today)
    t.record('claude-haiku-4-5', 's1', { input: 999, output: 999 }, yesterday)

    expect(t.current('s1').turns).toBe(2)
    expect(t.current('s2').turns).toBe(1)
    expect(t.allTime().turns).toBe(3)

    const tod = t.today(today)
    expect(tod.turns).toBe(2)
    expect(tod.inputTokens).toBe(300)
    expect(tod.outputTokens).toBe(130)
  })

  it('toUsd returns a finite non-negative number for known models', () => {
    const t = new CostTracker()
    t.record('claude-sonnet-4-6', 's1', { input: 10_000, output: 2_000, cacheCreate: 1_000, cacheRead: 500 })
    const usd = t.toUsd('claude-sonnet-4-6', t.current('s1'))
    expect(usd).toBeDefined()
    expect(Number.isFinite(usd!)).toBe(true)
    expect(usd!).toBeGreaterThanOrEqual(0)
  })

  it('toUsd is undefined for unknown models', () => {
    const t = new CostTracker()
    t.record('made-up-model', 's1', { input: 100, output: 100 })
    expect(t.toUsd('made-up-model', t.current('s1'))).toBeUndefined()
  })

  it('toUsd of an empty aggregate is 0 for known models', () => {
    const t = new CostTracker()
    const usd = t.toUsd('gpt-4o-mini', t.current('nonexistent-session'))
    expect(usd).toBe(0)
  })

  it('hydrate restores entries from a snapshot', () => {
    const a = new CostTracker()
    a.record('gpt-4o', 's1', { input: 1, output: 2 }, 100)
    const snap = a.snapshot()

    const b = new CostTracker()
    b.hydrate(snap)
    expect(b.allTime().turns).toBe(1)
    expect(b.allTime().inputTokens).toBe(1)
  })
})
