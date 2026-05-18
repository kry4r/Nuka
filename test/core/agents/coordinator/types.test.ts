import { describe, it, expect } from 'vitest'
import type {
  AgentSpec,
  CoordinatorInput,
  CoordinatorResult,
  BlackboardSnapshot,
  WorkerOutcome,
} from '../../../../src/core/agents/coordinator/types'

describe('coordinator types', () => {
  it('AgentSpec accepts name + task', () => {
    const a: AgentSpec = { name: 'research', task: 'find files' }
    expect(a.name).toBe('research')
  })
  it('CoordinatorInput has goal + agents + maxIterations', () => {
    const i: CoordinatorInput = {
      goal: 'fix bug',
      agents: [{ name: 'r', task: 't' }],
      maxIterations: 3,
    }
    expect(i.agents).toHaveLength(1)
  })
  it('CoordinatorResult sums outcomes', () => {
    const r: CoordinatorResult = {
      iterations: 1,
      blackboard: {} as BlackboardSnapshot,
      outcomes: [],
      hitCap: false,
    }
    expect(r.hitCap).toBe(false)
  })
  it('WorkerOutcome covers ok and error', () => {
    const ok: WorkerOutcome = {
      name: 'a', status: 'ok', summary: 'done', turns: 2, error: undefined,
    }
    const err: WorkerOutcome = {
      name: 'b', status: 'error', summary: '', turns: 0, error: 'boom',
    }
    expect(ok.status).toBe('ok')
    expect(err.error).toBe('boom')
  })
})
