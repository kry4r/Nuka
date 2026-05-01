import { describe, it, expect } from 'vitest'
import { pickSkillsForStage } from '../../../src/core/harness/skills'
import type { Triage } from '../../../src/core/harness/types'

const triage = (override: Partial<Triage> = {}): Triage => ({
  profile: 'feature',
  difficulty: 'medium',
  testStrategy: 'tdd',
  reasoning: 'r',
  userConfirmed: true,
  ...override,
})

describe('pickSkillsForStage (testStrategy-driven)', () => {
  it('feature/tdd implement → tdd + simplify', () => {
    const b = pickSkillsForStage('implement', triage())
    expect(b.required).toContain('tdd')
    expect(b.required).toContain('simplify')
    expect(b.forbidden).not.toContain('tdd')
  })

  it('doc + tdd 仍允许 TDD（testStrategy 决定，不看 profile）', () => {
    const b = pickSkillsForStage('implement', triage({ profile: 'doc', testStrategy: 'tdd' }))
    expect(b.required).toContain('tdd')
  })

  it('investigate 始终 forbid TDD（红线 profile）', () => {
    const b = pickSkillsForStage('implement', triage({ profile: 'investigate' }))
    expect(b.required).not.toContain('tdd')
    expect(b.forbidden).toContain('tdd')
  })

  it('brainstorm forbids tdd 和 simplify regardless of profile', () => {
    const b = pickSkillsForStage('brainstorm', triage({ profile: 'feature' }))
    expect(b.forbidden).toContain('tdd')
    expect(b.forbidden).toContain('simplify')
    expect(b.required).toContain('superpowers:brainstorming')
  })

  it('review with multi-test → 多 reviewer', () => {
    const b = pickSkillsForStage('review', triage({ testStrategy: 'multi-test' }))
    expect(b.required.filter((s) => s === 'superpowers:requesting-code-review').length).toBeGreaterThanOrEqual(1)
  })

  it('recap forbids tdd & simplify', () => {
    const b = pickSkillsForStage('recap', triage())
    expect(b.forbidden).toContain('tdd')
    expect(b.forbidden).toContain('simplify')
  })
})
