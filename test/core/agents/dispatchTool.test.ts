import { describe, it, expect } from 'vitest'
import { makeDispatchAgentTool } from '../../../src/core/agents/dispatchTool'
import { AgentRegistry } from '../../../src/core/agents/registry'
import { ToolRegistry } from '../../../src/core/tools/registry'
import type { LLMProvider } from '../../../src/core/provider/types'
import type { ProviderResolver } from '../../../src/core/provider/resolver'
import { PermissionChecker } from '../../../src/core/permission/checker'
import { PermissionCache } from '../../../src/core/permission/cache'
import { createSession } from '../../../src/core/session/session'
import type { ResolvedAgentDef } from '../../../src/core/agents/types'

function mkAgent(pluginName: string, name: string, description: string): ResolvedAgentDef {
  return {
    name,
    description,
    systemPrompt: 'system',
    maxTurns: 20,
    pluginName,
  }
}

function mkProvider(replyText: string): LLMProvider {
  return {
    id: 'p',
    format: 'openai',
    async *stream() {
      yield { type: 'text_delta', text: replyText }
      yield { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } }
    },
    async listRemoteModels() { return [] },
  } as LLMProvider
}

function mkResolver(p: LLMProvider): ProviderResolver {
  return {
    resolveFor: () => ({ provider: p, model: 'm' }),
    listProviders: () => [{ id: 'p' } as unknown as never],
  } as unknown as ProviderResolver
}

describe('makeDispatchAgentTool', () => {
  function makeDeps(agents: AgentRegistry) {
    const provider = mkProvider('subagent-response')
    const cache = new PermissionCache()
    return {
      agents,
      registry: new ToolRegistry(),
      providerResolver: mkResolver(provider),
      permission: new PermissionChecker(() => cache, async () => ({ allowed: true })),
    }
  }

  it('description lists all registered agents by qualified name', () => {
    const agents = new AgentRegistry()
    agents.register(mkAgent('core', 'reviewer', 'reviews code'))
    agents.register(mkAgent('core', 'tester', 'runs tests'))
    const tool = makeDispatchAgentTool(makeDeps(agents))
    expect(tool.name).toBe('dispatch_agent')
    expect(tool.description).toContain('core:reviewer')
    expect(tool.description).toContain('reviews code')
    expect(tool.description).toContain('core:tester')
    expect(tool.description).toContain('runs tests')
  })

  it('description handles the empty-registry case gracefully', () => {
    const tool = makeDispatchAgentTool(makeDeps(new AgentRegistry()))
    expect(tool.description).toMatch(/No specialist agents/)
  })

  it('dispatches to a valid agent and returns the sub-agent output', async () => {
    const agents = new AgentRegistry()
    agents.register(mkAgent('core', 'reviewer', 'reviews code'))
    const deps = makeDeps(agents)
    const tool = makeDispatchAgentTool(deps)
    const session = createSession({ providerId: 'p', model: 'm' })
    const result = await tool.run(
      { agent: 'core:reviewer', task: 'review this' },
      { signal: new AbortController().signal, cwd: process.cwd(), session },
    )
    expect(result.isError).toBe(false)
    expect(result.output).toBe('subagent-response')
  })

  it('returns a structured error (not throw) for unknown agent', async () => {
    const agents = new AgentRegistry()
    agents.register(mkAgent('core', 'reviewer', 'r'))
    const tool = makeDispatchAgentTool(makeDeps(agents))
    const session = createSession({ providerId: 'p', model: 'm' })
    const result = await tool.run(
      { agent: 'missing:one', task: 't' },
      { signal: new AbortController().signal, cwd: process.cwd(), session },
    )
    expect(result.isError).toBe(true)
    expect(result.output as string).toMatch(/Unknown agent/)
    expect(result.output as string).toMatch(/core:reviewer/)
  })

  it('recursion guard: refuses when ctx.session.allowedAgentDispatch === false', async () => {
    const agents = new AgentRegistry()
    agents.register(mkAgent('core', 'reviewer', 'r'))
    const tool = makeDispatchAgentTool(makeDeps(agents))
    const session = createSession({ providerId: 'p', model: 'm' })
    session.allowedAgentDispatch = false
    const result = await tool.run(
      { agent: 'core:reviewer', task: 't' },
      { signal: new AbortController().signal, cwd: process.cwd(), session },
    )
    expect(result.isError).toBe(true)
    expect(result.output as string).toMatch(/Sub-agents cannot dispatch/)
  })

  it('annotations flag readOnly so main-loop can parallelize sibling dispatches', () => {
    const tool = makeDispatchAgentTool(makeDeps(new AgentRegistry()))
    expect(tool.annotations).toEqual({ readOnly: true, destructive: false, openWorld: true })
  })
})
