import { afterEach, describe, expect, it } from 'vitest'
import {
  clearBundledSkills,
  getBundledSkills,
} from '../../../src/core/skill/bundled'
import { registerSkillifySkill } from '../../../src/core/skill/bundled/skillify'

describe('registerSkillifySkill', () => {
  afterEach(() => clearBundledSkills())

  it('registers a keyword-activated skill-authoring helper', () => {
    registerSkillifySkill()
    const [skill] = getBundledSkills()
    expect(skill?.name).toBe('skillify')
    expect(skill?.when).toEqual({
      keyword: ['skillify', 'extract skill', 'make a skill'],
    })
    expect(skill?.body).toContain('.nuka/skills/')
    expect(skill?.body).toContain('frontmatter')
  })
})
