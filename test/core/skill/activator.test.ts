import { describe, it, expect } from 'vitest'
import { alwaysOnSkills, matchKeywordSkills } from '../../../src/core/skill/activator'
import type { Skill } from '../../../src/core/skill/types'

function makeSkill(overrides: Partial<Skill>): Skill {
  return {
    name: 'test-skill',
    when: 'on-session-start',
    body: 'body text',
    source: 'global',
    path: '/fake/path.md',
    ...overrides,
  }
}

describe('alwaysOnSkills', () => {
  it('returns only skills with when === on-session-start', () => {
    const skills: Skill[] = [
      makeSkill({ name: 'always', when: 'on-session-start' }),
      makeSkill({ name: 'keyword', when: { keyword: ['deploy'] } }),
    ]
    const result = alwaysOnSkills(skills)
    expect(result).toHaveLength(1)
    expect(result[0]?.name).toBe('always')
  })

  it('returns empty array when no always-on skills', () => {
    const skills: Skill[] = [
      makeSkill({ name: 'kw', when: { keyword: ['test'] } }),
    ]
    expect(alwaysOnSkills(skills)).toEqual([])
  })
})

describe('matchKeywordSkills', () => {
  it('matches keyword (case-insensitive, whole-word) in user text', () => {
    const skills: Skill[] = [
      makeSkill({ name: 'deploy-skill', when: { keyword: ['deploy', 'release'] } }),
      makeSkill({ name: 'always', when: 'on-session-start' }),
    ]
    expect(matchKeywordSkills(skills, 'Please deploy the app')).toHaveLength(1)
    expect(matchKeywordSkills(skills, 'Run a RELEASE build')).toHaveLength(1)
    expect(matchKeywordSkills(skills, 'nothing relevant')).toHaveLength(0)
  })

  it('does not match partial-word hits', () => {
    const skills: Skill[] = [
      makeSkill({ name: 'test-skill', when: { keyword: ['test'] } }),
    ]
    expect(matchKeywordSkills(skills, 'testify the result')).toHaveLength(0)
    expect(matchKeywordSkills(skills, 'run test now')).toHaveLength(1)
  })

  it('matches case-insensitively', () => {
    const skills: Skill[] = [
      makeSkill({ name: 'migrate', when: { keyword: ['migration'] } }),
    ]
    expect(matchKeywordSkills(skills, 'running MIGRATION scripts')).toHaveLength(1)
    expect(matchKeywordSkills(skills, 'Migration needed')).toHaveLength(1)
  })
})
