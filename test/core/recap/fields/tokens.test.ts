import { describe, it, expect } from 'vitest'
import { reduceTokens } from '../../../../src/core/recap/fields/tokens'

describe('reduceTokens', () => {
  it('accumulates token usage per agent (sessionId)', () => {
    const r = reduceTokens([
      { topic: 'agent', t: 1000, payload: { type: 'agent.usage', sessionId: 'alice', inputTokens: 100, outputTokens: 50 } },
      { topic: 'agent', t: 2000, payload: { type: 'agent.usage', sessionId: 'alice', inputTokens: 200, outputTokens: 80 } },
      { topic: 'agent', t: 3000, payload: { type: 'agent.usage', sessionId: 'bob',   inputTokens: 300, outputTokens: 120 } },
    ])
    expect(Object.keys(r.perAgent).length).toBe(2)
    expect(r.perAgent['alice']!.in).toBe(300)
    expect(r.perAgent['alice']!.out).toBe(130)
    expect(r.perAgent['bob']!.in).toBe(300)
    expect(r.perAgent['bob']!.out).toBe(120)
  })

  it('ignores non-usage events', () => {
    const r = reduceTokens([
      { topic: 'agent', t: 0, payload: { type: 'agent.tool.start', sessionId: 's1', toolName: 'Read', input: {} } },
    ])
    expect(r.perAgent).toEqual({})
  })

  it('returns empty perAgent for empty input', () => {
    const r = reduceTokens([])
    expect(r.perAgent).toEqual({})
    expect(r.cost).toBeUndefined()
  })
})
