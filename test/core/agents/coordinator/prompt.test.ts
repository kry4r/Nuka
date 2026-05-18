import { describe, it, expect } from 'vitest'
import { composeWorkerPrompt } from '../../../../src/core/agents/coordinator/prompt'

describe('composeWorkerPrompt', () => {
  it('inlines goal + worker task + iteration number', () => {
    const text = composeWorkerPrompt({
      goal: 'Fix the auth bug',
      task: 'Find the null pointer',
      iteration: 1,
      blackboard: {},
    })
    expect(text).toMatch(/Fix the auth bug/)
    expect(text).toMatch(/Find the null pointer/)
    expect(text).toMatch(/Iteration 1/)
  })

  it('renders blackboard snapshot when non-empty', () => {
    const text = composeWorkerPrompt({
      goal: 'g',
      task: 't',
      iteration: 2,
      blackboard: { 'finding': 'null pointer at line 42' },
    })
    expect(text).toMatch(/finding/)
    expect(text).toMatch(/null pointer at line 42/)
  })

  it('omits blackboard section when empty', () => {
    const text = composeWorkerPrompt({ goal: 'g', task: 't', iteration: 1, blackboard: {} })
    expect(text).not.toMatch(/Blackboard:/)
  })

  it('instructs worker to emit `done: true` when finished', () => {
    const text = composeWorkerPrompt({ goal: 'g', task: 't', iteration: 1, blackboard: {} })
    expect(text).toMatch(/done:\s*true/i)
  })
})
