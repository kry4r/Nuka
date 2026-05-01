import { describe, it, expect, vi } from 'vitest'
import { planExecution } from '../../../src/core/coordination/scheduler'
import type { Triage } from '../../../src/core/harness/types'

const baseTriage = (override: Partial<Triage> = {}): Triage => ({
  profile: 'feature',
  difficulty: 'medium',
  testStrategy: 'tdd',
  reasoning: 'r',
  userConfirmed: true,
  ...override,
})

const validDecompose = JSON.stringify({
  tasks: [
    { id: 't1', title: 'A', profile: 'feature', testStrategy: 'tdd' },
    { id: 't2', title: 'B', profile: 'feature', testStrategy: 'tdd' },
  ],
  edges: [['t1', 't2', 'order']],
})

describe('planExecution', () => {
  it('simple → inline (不入图)', async () => {
    const fork = vi.fn()
    const plan = await planExecution({
      triage: baseTriage({ difficulty: 'simple' }),
      rootMessage: 'fix typo',
      runFork: fork,
    })
    expect(plan.kind).toBe('inline')
    expect(fork).not.toHaveBeenCalled()
  })

  it('medium → inline (也不入图)', async () => {
    const fork = vi.fn()
    const plan = await planExecution({
      triage: baseTriage({ difficulty: 'medium' }),
      rootMessage: 'add feature',
      runFork: fork,
    })
    expect(plan.kind).toBe('inline')
  })

  it('hard → graph 模式且 listening=false', async () => {
    const fork = vi.fn().mockResolvedValue({ text: validDecompose })
    const plan = await planExecution({
      triage: baseTriage({ difficulty: 'hard' }),
      rootMessage: 'big task',
      runFork: fork,
    })
    expect(plan.kind).toBe('graph')
    if (plan.kind === 'graph') {
      expect(plan.listening).toBe(false)
      expect(Object.keys(plan.graph.snapshot().nodes)).toHaveLength(2)
    }
  })

  it('hell → graph 模式且 listening=true', async () => {
    const fork = vi.fn().mockResolvedValue({ text: validDecompose })
    const plan = await planExecution({
      triage: baseTriage({ difficulty: 'hell' }),
      rootMessage: 'huge refactor',
      runFork: fork,
    })
    expect(plan.kind).toBe('graph')
    if (plan.kind === 'graph') {
      expect(plan.listening).toBe(true)
    }
  })
})
