import { describe, it, expect } from 'vitest'
import { reducePipelines } from '../../../../src/core/recap/fields/pipelines'

describe('reducePipelines', () => {
  it('groups 4 nodes across 2 pipelines → 2 pipeline rows', () => {
    const r = reducePipelines([
      { topic: 'harness', t: 100, payload: { type: 'harness.stage.enter', stage: 'brainstorm', sessionId: 'pipe-1/s1' } },
      { topic: 'harness', t: 200, payload: { type: 'harness.stage.exit', stage: 'brainstorm', sessionId: 'pipe-1/s1', reason: 'done' } },
      { topic: 'harness', t: 300, payload: { type: 'harness.stage.enter', stage: 'spec', sessionId: 'pipe-1/s2' } },
      { topic: 'harness', t: 400, payload: { type: 'harness.stage.enter', stage: 'plan', sessionId: 'pipe-2/s3' } },
      { topic: 'harness', t: 500, payload: { type: 'harness.stage.enter', stage: 'implement', sessionId: 'pipe-2/s4' } },
    ])
    expect(r.length).toBe(2)
    const p1 = r.find(x => x.pipelineId === 'pipe-1')
    expect(p1).toBeDefined()
    expect(p1!.nodes.length).toBe(2)
  })

  it('returns empty for no harness events', () => {
    const r = reducePipelines([
      { topic: 'task', t: 0, payload: { type: 'task.created', task: { id: 't1' } } },
    ])
    expect(r).toEqual([])
  })

  it('marks exited stage as completed', () => {
    const r = reducePipelines([
      { topic: 'harness', t: 100, payload: { type: 'harness.stage.enter', stage: 'brainstorm', sessionId: 'p1/s1' } },
      { topic: 'harness', t: 200, payload: { type: 'harness.stage.exit', stage: 'brainstorm', sessionId: 'p1/s1', reason: 'done' } },
    ])
    expect(r.length).toBe(1)
    expect(r[0]!.nodes[0]!.status).toBe('completed')
  })
})
