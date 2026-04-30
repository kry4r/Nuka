import { describe, it, expect } from 'vitest'
import { reduceInFlight } from '../../../../src/core/recap/fields/inFlight'

describe('reduceInFlight', () => {
  it('shows only non-terminal tasks', () => {
    const r = reduceInFlight([
      { topic: 'task', payload: { type: 'task.created', task: { id: 't1', description: 'task one', state: 'running' } as any } },
      { topic: 'task', payload: { type: 'task.created', task: { id: 't2', description: 'task two', state: 'running' } as any } },
      { topic: 'task', payload: { type: 'task.state', id: 't1', from: 'running', to: 'completed' } as any, t: 5000 },
    ])
    expect(r.length).toBe(1)
    expect(r[0]!.id).toBe('t2')
  })

  it('returns empty for no running tasks', () => {
    const r = reduceInFlight([
      { topic: 'task', payload: { type: 'task.created', task: { id: 't1', description: 'x', state: 'pending' } as any } },
      { topic: 'task', payload: { type: 'task.state', id: 't1', from: 'pending', to: 'failed' } as any, t: 0 },
    ])
    expect(r).toEqual([])
  })

  it('treats killed tasks as terminal', () => {
    const r = reduceInFlight([
      { topic: 'task', payload: { type: 'task.created', task: { id: 't1', description: 'x', state: 'running' } as any } },
      { topic: 'task', payload: { type: 'task.state', id: 't1', from: 'running', to: 'killed' } as any, t: 0 },
    ])
    expect(r).toEqual([])
  })
})
