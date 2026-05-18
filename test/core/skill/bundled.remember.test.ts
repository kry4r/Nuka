import { afterEach, describe, expect, it } from 'vitest'
import {
  clearBundledSkills,
  getBundledSkills,
} from '../../../src/core/skill/bundled'
import { registerRememberSkill } from '../../../src/core/skill/bundled/remember'

describe('registerRememberSkill', () => {
  afterEach(() => {
    clearBundledSkills()
    delete process.env['NUKA_SKILL_REMEMBER']
  })

  it('does not register when opt-in is off', () => {
    registerRememberSkill()
    expect(getBundledSkills()).toEqual([])
  })

  it('registers a memdir-aware keyword skill on opt-in', () => {
    process.env['NUKA_SKILL_REMEMBER'] = '1'
    registerRememberSkill()
    const [skill] = getBundledSkills()
    expect(skill?.name).toBe('remember')
    expect(skill?.when).toEqual({
      keyword: ['remember', 'memorize', 'save to memory'],
    })
    expect(skill?.body).toContain('memdir')
  })
})
