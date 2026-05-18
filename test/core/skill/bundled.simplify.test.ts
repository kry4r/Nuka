import { afterEach, describe, expect, it } from 'vitest'
import {
  clearBundledSkills,
  getBundledSkills,
} from '../../../src/core/skill/bundled'
import { registerSimplifySkill } from '../../../src/core/skill/bundled/simplify'

describe('registerSimplifySkill', () => {
  afterEach(() => clearBundledSkills())

  it('registers a keyword-activated review skill', () => {
    registerSimplifySkill()
    const [skill] = getBundledSkills()
    expect(skill?.name).toBe('simplify')
    expect(skill?.when).toEqual({
      keyword: ['simplify', 'review', 'cleanup', 'code review'],
    })
    expect(skill?.body).toContain('Code Reuse Review')
    expect(skill?.body).toContain('Code Quality Review')
    expect(skill?.body).toContain('Efficiency Review')
  })
})
