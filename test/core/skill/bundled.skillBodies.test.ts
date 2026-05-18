import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearBundledSkills,
  getBundledSkills,
} from '../../../src/core/skill/bundled'
import { initBundledSkills } from '../../../src/core/skill/bundled/index'

describe('bundled skills — body resolves without runtime error', () => {
  beforeEach(() => {
    process.env['NUKA_SKILL_LOREM_IPSUM'] = '1'
    process.env['NUKA_SKILL_STUCK'] = '1'
    process.env['NUKA_SKILL_REMEMBER'] = '1'
    clearBundledSkills()
  })
  afterEach(() => {
    clearBundledSkills()
    delete process.env['NUKA_SKILL_LOREM_IPSUM']
    delete process.env['NUKA_SKILL_STUCK']
    delete process.env['NUKA_SKILL_REMEMBER']
  })

  it('initBundledSkills does not throw', () => {
    expect(() => initBundledSkills()).not.toThrow()
  })

  it('every registered tier-1 skill has a non-empty body and valid `when`', () => {
    initBundledSkills()
    const skills = getBundledSkills()
    expect(skills.length).toBe(5)
    for (const s of skills) {
      expect(s.body).toMatch(/\S/)
      if (typeof s.when === 'string') {
        expect(s.when).toBe('on-session-start')
      } else {
        expect(Array.isArray(s.when.keyword)).toBe(true)
        expect(s.when.keyword.length).toBeGreaterThan(0)
      }
    }
  })

  it('no bundled skill body references MCP or claude-for-chrome', () => {
    initBundledSkills()
    for (const s of getBundledSkills()) {
      expect(s.body).not.toMatch(/MCP|claude-for-chrome|@ant\//)
    }
  })
})
