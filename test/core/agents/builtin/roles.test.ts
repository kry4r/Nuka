import { describe, it, expect } from 'vitest'
import { ROLE_AGENTS } from '../../../../src/core/agents/builtin/roles'

describe('ROLE_AGENTS', () => {
  it('exposes 6 default role defs', () => {
    expect(ROLE_AGENTS.map(a => a.name)).toEqual([
      'core:planner', 'core:skeptic', 'core:explorer', 'core:researcher', 'core:implementer', 'core:reviewer',
    ])
  })

  it('planner is read-only', () => {
    const planner = ROLE_AGENTS.find(a => a.name === 'core:planner')!
    const allowed = planner.allowedTools ?? []
    expect(allowed).not.toContain('Edit')
    expect(allowed).not.toContain('Write')
    expect(allowed).not.toContain('Bash')
  })

  it('reviewer denies Bash except git/ls', () => {
    const r = ROLE_AGENTS.find(a => a.name === 'core:reviewer')!
    expect(r.deniedTools).toContain('Edit')
    expect(r.deniedTools).toContain('Write')
  })

  it('explorer is a fast read-only code search role', () => {
    const explorer = ROLE_AGENTS.find(a => a.name === 'core:explorer')!
    expect(explorer.description).toMatch(/code/i)
    expect(explorer.systemPrompt).toMatch(/read-only/i)
    expect(explorer.allowedTools).toEqual(['Read', 'Grep', 'Glob', 'LSPQuery'])
    expect(explorer.deniedTools).toEqual(['Edit', 'Write', 'Bash'])
    expect(explorer.maxTurns).toBeLessThanOrEqual(10)
  })
})
