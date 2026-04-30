import { describe, it, expect } from 'vitest'
import { reduceToolTimeline } from '../../../../src/core/recap/fields/toolTimeline'

describe('reduceToolTimeline', () => {
  it('collapses 5 consecutive Read calls → 1 row with collapsedCount=5', () => {
    const records = Array.from({ length: 5 }, (_, i) => ({
      topic: 'agent',
      t: 1000 + i * 100,
      payload: { type: 'agent.tool.start', sessionId: 's1', toolName: 'Read', input: {} },
    }))
    const r = reduceToolTimeline(records)
    expect(r.length).toBe(1)
    expect(r[0]!.collapsedCount).toBe(5)
    expect(r[0]!.toolName).toBe('Read')
  })

  it('does not collapse different tools', () => {
    const r = reduceToolTimeline([
      { topic: 'agent', t: 1000, payload: { type: 'agent.tool.start', sessionId: 's1', toolName: 'Read', input: {} } },
      { topic: 'agent', t: 2000, payload: { type: 'agent.tool.start', sessionId: 's1', toolName: 'Bash', input: {} } },
      { topic: 'agent', t: 3000, payload: { type: 'agent.tool.start', sessionId: 's1', toolName: 'Read', input: {} } },
    ])
    expect(r.length).toBe(3)
  })

  it('collapses same tool in same session only', () => {
    const r = reduceToolTimeline([
      { topic: 'agent', t: 1000, payload: { type: 'agent.tool.start', sessionId: 's1', toolName: 'Grep', input: {} } },
      { topic: 'agent', t: 2000, payload: { type: 'agent.tool.start', sessionId: 's2', toolName: 'Grep', input: {} } },
    ])
    // Different sessions — should NOT collapse
    expect(r.length).toBe(2)
  })
})
