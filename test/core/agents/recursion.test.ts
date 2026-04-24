import { describe, it, expect } from 'vitest'
import { makeDispatchAgentTool } from '../../../src/core/agents/dispatchTool'
import { AgentRegistry } from '../../../src/core/agents/registry'
import { ToolRegistry } from '../../../src/core/tools/registry'
import type { LLMProvider } from '../../../src/core/provider/types'
import type { ProviderResolver } from '../../../src/core/provider/resolver'
import { PermissionChecker } from '../../../src/core/permission/checker'
import { PermissionCache } from '../../../src/core/permission/cache'
import { createSession } from '../../../src/core/session/session'

function mkResolver(p: LLMProvider): ProviderResolver {
  return {
    resolveFor: () => ({ provider: p, model: 'm' }),
    listProviders: () => [{ id: 'p' } as unknown as never],
  } as unknown as ProviderResolver
}

describe('dispatch_agent recursion guard (end-to-end)', () => {
  it('a sub-agent that tries to call dispatch_agent is refused', async () => {
    // The sub-agent's registry contains dispatch_agent. The sub-agent's
    // session has allowedAgentDispatch=false. Calling the tool should
    // return a structured error without ever reaching the provider.
    const agents = new AgentRegistry()
    agents.register({
      name: 'inner',
      description: 'inner',
      systemPrompt: 's',
      maxTurns: 20,
      pluginName: 'core',
    })
    const permission = new PermissionChecker(new PermissionCache(), async () => ({ allowed: true }))
    // A provider that should never be called — if it is, it throws.
    const provider: LLMProvider = {
      id: 'p', format: 'openai',
      async *stream() {
        throw new Error('should not reach provider')
      },
      async listRemoteModels() { return [] },
    } as LLMProvider

    const dispatchTool = makeDispatchAgentTool({
      agents,
      registry: new ToolRegistry(),
      providerResolver: mkResolver(provider),
      permission,
    })

    // Simulate a sub-session invoking dispatch_agent.
    const subSession = createSession({ providerId: 'p', model: 'm' })
    subSession.allowedAgentDispatch = false

    const result = await dispatchTool.run(
      { agent: 'core:inner', task: 'recurse' },
      { signal: new AbortController().signal, cwd: process.cwd(), session: subSession },
    )

    expect(result.isError).toBe(true)
    expect(result.output as string).toMatch(/cannot dispatch further sub-agents/i)
  })
})
