import { describe, it, expect, vi } from 'vitest'
import { AgentRegistry } from '../../../src/core/agents/registry'
import type { ResolvedAgentDef } from '../../../src/core/agents/types'

function make(pluginName: string, name: string, extra: Partial<ResolvedAgentDef> = {}): ResolvedAgentDef {
  return {
    name,
    description: `${name} agent`,
    systemPrompt: 'You are helpful.',
    maxTurns: 20,
    pluginName,
    ...extra,
  }
}

describe('AgentRegistry', () => {
  it('registers and finds an agent under <plugin>:<name>', () => {
    const reg = new AgentRegistry()
    reg.register(make('core', 'reviewer'))
    expect(reg.find('core:reviewer')?.description).toBe('reviewer agent')
    expect(reg.list()).toHaveLength(1)
    expect(reg.list()[0]!.name).toBe('core:reviewer')
  })

  it('supports multiple agents from the same plugin', () => {
    const reg = new AgentRegistry()
    reg.register(make('core', 'reviewer'))
    reg.register(make('core', 'tester'))
    expect(reg.list()).toHaveLength(2)
    expect(reg.find('core:reviewer')).toBeDefined()
    expect(reg.find('core:tester')).toBeDefined()
  })

  it('returns undefined for unknown names', () => {
    const reg = new AgentRegistry()
    expect(reg.find('missing:x')).toBeUndefined()
  })

  it('skips duplicate qualified names with a warning', () => {
    const reg = new AgentRegistry()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    reg.register(make('core', 'reviewer'))
    reg.register(make('core', 'reviewer', { description: 'dup' }))
    expect(reg.list()).toHaveLength(1)
    expect(reg.find('core:reviewer')?.description).toBe('reviewer agent')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('does not collide across plugin namespaces', () => {
    const reg = new AgentRegistry()
    reg.register(make('core', 'reviewer'))
    reg.register(make('extra', 'reviewer'))
    expect(reg.list()).toHaveLength(2)
    expect(reg.find('core:reviewer')).toBeDefined()
    expect(reg.find('extra:reviewer')).toBeDefined()
  })
})
