import { describe, it, expect } from 'vitest'
import type { TaskProfile, Difficulty, TestStrategy, Triage } from '../../../src/core/harness/types'

describe('harness types', () => {
  it('TaskProfile 包含新 6 类', () => {
    const profiles: TaskProfile[] = ['feature', 'debug-fix', 'refactor', 'investigate', 'doc', 'odd-jobs']
    expect(profiles).toHaveLength(6)
  })
  it('Difficulty 4 档', () => {
    const d: Difficulty[] = ['simple', 'medium', 'hard', 'hell']
    expect(d).toHaveLength(4)
  })
  it('TestStrategy 3 档', () => {
    const t: TestStrategy[] = ['tdd', 'cross-module', 'multi-test']
    expect(t).toHaveLength(3)
  })
  it('Triage 包含 reasoning + userConfirmed', () => {
    const triage: Triage = { profile: 'feature', difficulty: 'medium', testStrategy: 'tdd', reasoning: 'r', userConfirmed: true }
    expect(triage.userConfirmed).toBe(true)
  })
})
