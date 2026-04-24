import { describe, it, expect } from 'vitest'
import { makeSkillTool } from '../../../src/core/skill/skillTool'
import type { Skill } from '../../../src/core/skill/types'

function makeSkill(overrides: Partial<Skill>): Skill {
  return {
    name: 'test-skill',
    when: 'on-session-start',
    body: 'skill body content',
    source: 'global',
    path: '/fake/path.md',
    ...overrides,
  }
}

const ctx = { signal: new AbortController().signal, cwd: '/tmp' }

describe('makeSkillTool', () => {
  it('returns skill body for a known skill name', async () => {
    const skill = makeSkill({ name: 'my-skill', body: 'Do the thing.' })
    const tool = makeSkillTool([skill])
    const result = await tool.run({ name: 'my-skill' }, ctx)
    expect(result.isError).toBe(false)
    expect(result.output).toBe('[Skill: my-skill]\n\nDo the thing.')
  })

  it('returns isError true for unknown skill name', async () => {
    const tool = makeSkillTool([])
    const result = await tool.run({ name: 'nonexistent' }, ctx)
    expect(result.isError).toBe(true)
    expect(result.output).toBe('Unknown skill: nonexistent')
  })
})
