import { describe, it, expect } from 'vitest'
import { buildRecap } from '../../../src/core/recap/builder'

describe('buildRecap', () => {
  it('produces RecapDoc with all 9 fields', async () => {
    const doc = await buildRecap({
      sessionId: 's1',
      scope: { kind: 'full' },
      events: [],
      session: { messages: [] } as any,
      runFork: async () => ({ text: 'next step suggestion' }),
    })
    const f = doc.fields
    expect(Array.isArray(f.completed)).toBe(true)
    expect(Array.isArray(f.inFlight)).toBe(true)
    expect(Array.isArray(f.fileDiffs)).toBe(true)
    expect(Array.isArray(f.toolTimeline)).toBe(true)
    expect(Array.isArray(f.messages)).toBe(true)
    expect(Array.isArray(f.pipelines)).toBe(true)
    expect(typeof f.tokens.perAgent).toBe('object')
    expect(f.nextStep.length).toBeGreaterThan(0)
    expect(Array.isArray(f.keyDecisions)).toBe(true)
  })

  it('populates session + generatedAt + scope', async () => {
    const before = Date.now()
    const doc = await buildRecap({
      sessionId: 'test-sess',
      scope: { kind: 'since', ms: 3600_000 },
      events: [],
      session: { messages: [] } as any,
      runFork: async () => ({ text: 'x' }),
    })
    expect(doc.session).toBe('test-sess')
    expect(doc.generatedAt).toBeGreaterThanOrEqual(before)
    expect(doc.scope).toEqual({ kind: 'since', ms: 3600_000 })
  })
})
