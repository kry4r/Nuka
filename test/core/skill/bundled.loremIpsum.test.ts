import { afterEach, describe, expect, it } from 'vitest'
import {
  clearBundledSkills,
  getBundledSkills,
} from '../../../src/core/skill/bundled'
import { registerLoremIpsumSkill } from '../../../src/core/skill/bundled/loremIpsum'

describe('registerLoremIpsumSkill', () => {
  afterEach(() => {
    clearBundledSkills()
    delete process.env['NUKA_SKILL_LOREM_IPSUM']
  })

  it('does not register when env opt-in is off', () => {
    registerLoremIpsumSkill()
    expect(getBundledSkills()).toEqual([])
  })

  it('registers a keyword-activated skill when opt-in is on', () => {
    process.env['NUKA_SKILL_LOREM_IPSUM'] = '1'
    registerLoremIpsumSkill()
    const [skill] = getBundledSkills()
    expect(skill?.name).toBe('lorem-ipsum')
    expect(skill?.when).toEqual({
      keyword: ['lorem', 'filler text', 'placeholder text'],
    })
    expect(skill?.body.length).toBeGreaterThan(1000)
  })
})
