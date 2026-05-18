import { afterEach, describe, expect, it } from 'vitest'
import {
  clearBundledSkills,
  getBundledSkills,
} from '../../../src/core/skill/bundled'
import { registerStuckSkill } from '../../../src/core/skill/bundled/stuck'

describe('registerStuckSkill', () => {
  afterEach(() => {
    clearBundledSkills()
    delete process.env['NUKA_SKILL_STUCK']
  })

  it('does not register when env opt-in is off', () => {
    registerStuckSkill()
    expect(getBundledSkills()).toEqual([])
  })

  it('registers a keyword-activated diagnostic skill on opt-in', () => {
    process.env['NUKA_SKILL_STUCK'] = '1'
    registerStuckSkill()
    const [skill] = getBundledSkills()
    expect(skill?.name).toBe('stuck')
    expect(skill?.when).toEqual({
      keyword: ['stuck', 'frozen', 'hung', 'unresponsive'],
    })
    expect(skill?.body).toContain('High CPU')
    expect(skill?.body).not.toMatch(/slack|mcp/i)
  })
})
