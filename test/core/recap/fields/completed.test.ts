import { describe, it, expect } from 'vitest'
import { reduceCompleted } from '../../../../src/core/recap/fields/completed'

describe('reduceCompleted', () => {
  it('captures task.state → completed transitions', () => {
    const r = reduceCompleted([
      { topic: 'task' as const, payload: { type: 'task.created', task: { id: 't1', description: 'do x', startedAt: 1000, agentName: 'alice' } as any } },
      { topic: 'task' as const, payload: { type: 'task.state', id: 't1', from: 'running', to: 'completed' } as any, t: 4000 },
    ])
    expect(r.length).toBe(1)
    expect(r[0]!.id).toBe('t1')
    expect(r[0]!.durationMs).toBe(3000)
    expect(r[0]!.agentName).toBe('alice')
  })
  it('ignores non-completed transitions', () => {
    expect(reduceCompleted([
      { topic: 'task' as const, payload: { type: 'task.state', id: 't1', from: 'running', to: 'failed' } as any, t: 0 },
    ])).toEqual([])
  })
})
