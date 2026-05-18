import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearBundledSkills,
  getBundledSkills,
} from '../../../src/core/skill/bundled'
import { initBundledSkills } from '../../../src/core/skill/bundled/index'

describe('initBundledSkills', () => {
  beforeEach(() => clearBundledSkills())
  afterEach(() => {
    clearBundledSkills()
    delete process.env['NUKA_SKILL_LOREM_IPSUM']
    delete process.env['NUKA_SKILL_STUCK']
    delete process.env['NUKA_SKILL_REMEMBER']
  })

  it('registers the always-on tier-1 skills by default', () => {
    initBundledSkills()
    const names = getBundledSkills()
      .map((s) => s.name)
      .sort()
    expect(names).toEqual(['simplify', 'skillify'])
  })

  it('registers all five tier-1 skills when all opt-ins are on', () => {
    process.env['NUKA_SKILL_LOREM_IPSUM'] = '1'
    process.env['NUKA_SKILL_STUCK'] = '1'
    process.env['NUKA_SKILL_REMEMBER'] = '1'
    initBundledSkills()
    const names = getBundledSkills()
      .map((s) => s.name)
      .sort()
    expect(names).toEqual([
      'lorem-ipsum',
      'remember',
      'simplify',
      'skillify',
      'stuck',
    ])
  })

  it('each registered skill has a non-empty body', () => {
    process.env['NUKA_SKILL_LOREM_IPSUM'] = '1'
    process.env['NUKA_SKILL_STUCK'] = '1'
    process.env['NUKA_SKILL_REMEMBER'] = '1'
    initBundledSkills()
    for (const s of getBundledSkills()) {
      expect(s.body.length).toBeGreaterThan(50)
    }
  })

  it('is idempotent across multiple calls', () => {
    initBundledSkills()
    initBundledSkills()
    initBundledSkills()
    const names = getBundledSkills().map((s) => s.name)
    // No duplicates — registerBundledSkill replaces by name
    expect(new Set(names).size).toBe(names.length)
  })
})
