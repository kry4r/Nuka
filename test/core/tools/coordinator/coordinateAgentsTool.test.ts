import { describe, it, expect, vi } from 'vitest'
import { makeCoordinateAgentsTool, COORDINATE_AGENTS_TOOL_NAME } from '../../../../src/core/tools/coordinator/coordinateAgentsTool'
import { AgentRegistry } from '../../../../src/core/agents/registry'
import { ToolRegistry } from '../../../../src/core/tools/registry'
import type { ResolvedAgentDef } from '../../../../src/core/agents/types'
import type { DispatchAgentOpts, DispatchAgentResult } from '../../../../src/core/agents/dispatch'

function makeAgent(name: string): ResolvedAgentDef {
  return { name, description: 'd', systemPrompt: 'sp', pluginName: 'p', maxTurns: 20 }
}

function ctx(extra?: Partial<{ allowedAgentDispatch: boolean }>) {
  return {
    signal: new AbortController().signal,
    cwd: process.cwd(),
    session: extra?.allowedAgentDispatch === undefined
      ? undefined
      : {
          id: 's', providerId: 'p', model: 'm', messages: [],
          totalUsage: { inputTokens: 0, outputTokens: 0 },
          permissionCache: { add: () => {}, list: () => [] } as never,
          queue: {} as never,
          mode: 'normal' as const,
          createdAt: 0, updatedAt: 0,
          unDeferredToolNames: new Set<string>(),
          allowedAgentDispatch: extra.allowedAgentDispatch,
        },
  }
}

describe('coordinate_agents tool', () => {
  const agents = new AgentRegistry()
  agents.register(makeAgent('a'))
  const dispatch = vi.fn(async (_o: DispatchAgentOpts): Promise<DispatchAgentResult> => ({
    output: 'done: true', isError: false, turns: 1, usage: { inputTokens: 0, outputTokens: 0 },
  }))

  const tool = makeCoordinateAgentsTool({
    agents,
    registry: new ToolRegistry(),
    providerResolver: { listProviders: () => [{ id: 'x' }] } as never,
    permission: { check: async () => ({ allowed: true }) } as never,
    dispatch,
  })

  it('has the expected name', () => {
    expect(tool.name).toBe(COORDINATE_AGENTS_TOOL_NAME)
    expect(COORDINATE_AGENTS_TOOL_NAME).toBe('coordinate_agents')
  })

  it('runs through and returns structured summary', async () => {
    const res = await tool.run(
      {
        goal: 'fix bug',
        agents: [{ name: 'p:a', task: 't' }],
        maxIterations: 2,
      },
      ctx() as never,
    )
    expect(res.isError).toBe(false)
    expect(typeof res.output).toBe('string')
    expect(res.output as string).toMatch(/iteration/i)
  })

  it('recursion guard: refuses when called from a sub-agent', async () => {
    const res = await tool.run(
      { goal: 'g', agents: [{ name: 'p:a', task: 't' }], maxIterations: 1 },
      ctx({ allowedAgentDispatch: false }) as never,
    )
    expect(res.isError).toBe(true)
    expect(res.output as string).toMatch(/sub-agent/i)
  })

  it('validates: empty agents array → error', async () => {
    const res = await tool.run(
      { goal: 'g', agents: [], maxIterations: 1 },
      ctx() as never,
    )
    expect(res.isError).toBe(true)
  })

  it('validates: maxIterations bounds (1..10)', async () => {
    const tooHigh = await tool.run(
      { goal: 'g', agents: [{ name: 'p:a', task: 't' }], maxIterations: 99 },
      ctx() as never,
    )
    expect(tooHigh.isError).toBe(true)
  })
})
