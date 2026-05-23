import { describe, it, expect } from 'vitest'
import { ROLE_AGENTS } from '../../../../src/core/agents/builtin/roles'

describe('ROLE_AGENTS', () => {
  it('exposes 7 default role defs', () => {
    expect(ROLE_AGENTS.map(a => a.name)).toEqual([
      'core:planner', 'core:skeptic', 'core:explorer', 'core:researcher', 'core:implementer', 'core:verifier', 'core:reviewer',
    ])
  })

  it('planner is read-only', () => {
    const planner = ROLE_AGENTS.find(a => a.name === 'core:planner')!
    const allowed = planner.allowedTools ?? []
    expect(allowed).not.toContain('Edit')
    expect(allowed).not.toContain('Write')
    expect(allowed).not.toContain('Bash')
  })

  it('planner explores before producing critical files for implementation', () => {
    const planner = ROLE_AGENTS.find(a => a.name === 'core:planner')!
    expect(planner.systemPrompt).toMatch(/Explore/i)
    expect(planner.systemPrompt).toMatch(/Critical Files for Implementation/)
    expect(planner.systemPrompt).toMatch(/implementation strategy/i)
    expect(planner.allowedTools).toContain('LSPQuery')
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

  it('verifier can run checks but cannot edit files', () => {
    const verifier = ROLE_AGENTS.find(a => a.name === 'core:verifier')!
    expect(verifier.description).toMatch(/verif/i)
    expect(verifier.systemPrompt).toMatch(/VERDICT:/)
    expect(verifier.systemPrompt).toMatch(/Do not modify/i)
    expect(verifier.allowedTools).toContain('Bash')
    expect(verifier.allowedTools).toContain('Read')
    expect(verifier.deniedTools).toEqual(['Edit', 'Write'])
    expect(verifier.maxTurns).toBeGreaterThanOrEqual(12)
  })
})
