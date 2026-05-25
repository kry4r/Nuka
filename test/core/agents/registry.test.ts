import { describe, it, expect, vi } from 'vitest'
import {
  AgentRegistry,
  inferAvailableMcpServersFromToolNames,
} from '../../../src/core/agents/registry'
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

  it('filters agents by required MCP server availability', () => {
    const reg = new AgentRegistry()
    reg.register(make('core', 'plain'))
    reg.register(make('core', 'github-reviewer', {
      requiredMcpServers: ['github'],
    }))
    reg.register(make('core', 'linear-reviewer', {
      requiredMcpServers: ['linear'],
    }))

    expect(reg.listAvailable(['project-github-server']).map(a => a.name).sort()).toEqual([
      'core:github-reviewer',
      'core:plain',
    ])
    expect(reg.findAvailable('core:github-reviewer', ['GitHub'])).toBeDefined()
    expect(reg.findAvailable('core:linear-reviewer', ['github'])).toBeUndefined()
  })

  it('infers MCP server names from mcp__server__tool names', () => {
    expect(inferAvailableMcpServersFromToolNames([
      'Read',
      'mcp__github__search_issues',
      'mcp__claude_in_chrome__tabs_context_mcp',
      'mcp__github__create_issue',
      'mcp__broken',
    ])).toEqual(['github', 'claude_in_chrome'])
  })
})
