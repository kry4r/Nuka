import { describe, it, expect } from 'vitest'
import { pickSkillsForStage } from '../../../src/core/harness/skills'

describe('pickSkillsForStage', () => {
  it('explore profile forbids tdd', () => {
    const b = pickSkillsForStage('implement', 'explore')
    expect(b.forbidden).toContain('tdd')
  })
  it('feature implement requires tdd', () => {
    const b = pickSkillsForStage('implement', 'feature')
    expect(b.required).toContain('tdd')
  })
  it('docs implement no tdd', () => {
    const b = pickSkillsForStage('implement', 'docs')
    expect(b.required).not.toContain('tdd')
  })
  it('brainstorm always brings brainstorming skill', () => {
    expect(pickSkillsForStage('brainstorm', 'feature').required).toContain('superpowers:brainstorming')
  })
})
