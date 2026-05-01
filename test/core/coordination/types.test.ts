import { describe, it, expect } from 'vitest'
import type { SubTask, TaskGraph, A2ASubscription } from '../../../src/core/coordination/types'

describe('coordination types', () => {
  it('SubTask 接受三轴中的 profile/testStrategy', () => {
    const t: SubTask = {
      id: '01HX',
      title: 'do thing',
      profile: 'feature',
      testStrategy: 'tdd',
      agentId: null,
      status: 'pending',
      dependsOn: [],
      contextFor: [],
      result: null,
    }
    expect(t.status).toBe('pending')
    expect(t.profile).toBe('feature')
  })

  it('TaskGraph 含 nodes + correlations', () => {
    const g: TaskGraph = {
      rootMessage: 'do everything',
      difficulty: 'hard',
      nodes: {},
      correlations: [],
    }
    expect(g.difficulty).toBe('hard')
  })

  it('A2ASubscription 含 triggerCount + lifecycle', () => {
    const sub: A2ASubscription = {
      subscriberAgentId: 'agent1',
      ownsTaskId: 't-a',
      triggersOn: ['t-b'],
      triggerCount: 0,
      lifecycle: 'until-correlated-tasks-done',
    }
    expect(sub.triggerCount).toBe(0)
    expect(sub.lifecycle).toBe('until-correlated-tasks-done')
  })

  it('SubTask.status 含 listening 状态', () => {
    const statuses: SubTask['status'][] = ['pending', 'running', 'listening', 'done', 'failed']
    expect(statuses).toContain('listening')
  })
})
