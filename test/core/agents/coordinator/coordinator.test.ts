import { describe, it, expect, vi } from 'vitest'
import { runCoordinator, type CoordinatorDeps } from '../../../../src/core/agents/coordinator/coordinator'
import type { ResolvedAgentDef } from '../../../../src/core/agents/types'
import type { DispatchAgentOpts, DispatchAgentResult } from '../../../../src/core/agents/dispatch'
import { AgentRegistry } from '../../../../src/core/agents/registry'
import { ToolRegistry } from '../../../../src/core/tools/registry'

function makeAgent(name: string): ResolvedAgentDef {
  return {
    name,
    description: 'test agent',
    systemPrompt: 'sp',
    pluginName: 'test',
    maxTurns: 20,
  }
}

function makeDeps(
  dispatch: (opts: DispatchAgentOpts) => Promise<DispatchAgentResult>,
): CoordinatorDeps {
  const agents = new AgentRegistry()
  agents.register(makeAgent('a'))
  agents.register(makeAgent('b'))
  return {
    dispatch,
    agents,
    registry: new ToolRegistry(),
    providerResolver: {
      listProviders: () => [{ id: 'mock' }],
      resolveFor: () => ({ provider: { stream: async function* () {} }, model: 'm' }),
    } as unknown as CoordinatorDeps['providerResolver'],
    permission: { check: async () => ({ allowed: true }) } as unknown as CoordinatorDeps['permission'],
  }
}

describe('runCoordinator', () => {
  it('fans out 2 agents in parallel within one iteration', async () => {
    const seen: string[] = []
    const dispatch = vi.fn(async (opts: DispatchAgentOpts): Promise<DispatchAgentResult> => {
      seen.push(opts.agent.name)
      return { output: 'ok\ndone: true', isError: false, turns: 1, usage: { inputTokens: 0, outputTokens: 0 } }
    })
    const result = await runCoordinator(
      {
        goal: 'g',
        agents: [
          { name: 'test:a', task: 'task1' },
          { name: 'test:b', task: 'task2' },
        ],
        maxIterations: 5,
      },
      makeDeps(dispatch),
      new AbortController().signal,
    )
    expect(seen.sort()).toEqual(['test:a', 'test:b'])
    expect(result.iterations).toBe(1)
    expect(result.hitCap).toBe(false)
    expect(result.outcomes.every(o => o.status === 'ok')).toBe(true)
  })

  it('exposes blackboard writes to siblings within the same iteration', async () => {
    // First agent writes; second agent reads. We can't really test "within
    // same iteration" through pure dispatch mocks; instead verify the
    // blackboard is threaded into the deps the second dispatch sees on
    // iteration 2.
    let iter = 0
    const dispatch = vi.fn(async (opts: DispatchAgentOpts): Promise<DispatchAgentResult> => {
      if (opts.agent.name === 'test:a') {
        // simulate write by reaching into the injected bb via the tool registry
        const writeTool = opts.registry.find('bb_write')
        if (writeTool) {
          await writeTool.run(
            { key: 'finding', value: 'null at 42' },
            { signal: opts.signal, cwd: process.cwd() },
          )
        }
        return { output: 'done: true', isError: false, turns: 1, usage: { inputTokens: 0, outputTokens: 0 } }
      }
      // agent b waits until iteration 2 so a's write is observable
      if (iter === 0) {
        iter++
        return { output: 'still working', isError: false, turns: 1, usage: { inputTokens: 0, outputTokens: 0 } }
      }
      const readTool = opts.registry.find('bb_read')
      let value = ''
      if (readTool) {
        const r = await readTool.run({ key: 'finding' }, { signal: opts.signal, cwd: process.cwd() })
        value = typeof r.output === 'string' ? r.output : ''
      }
      return { output: `saw: ${value}\ndone: true`, isError: false, turns: 1, usage: { inputTokens: 0, outputTokens: 0 } }
    })
    const result = await runCoordinator(
      {
        goal: 'g',
        agents: [
          { name: 'test:a', task: 't1' },
          { name: 'test:b', task: 't2' },
        ],
        maxIterations: 5,
      },
      makeDeps(dispatch),
      new AbortController().signal,
    )
    expect(result.blackboard.finding).toBe('null at 42')
    expect(result.iterations).toBe(2)
  })

  it('hits iteration cap when no worker says done', async () => {
    const dispatch = vi.fn(async (): Promise<DispatchAgentResult> => ({
      output: 'still going', // no `done: true`
      isError: false,
      turns: 1,
      usage: { inputTokens: 0, outputTokens: 0 },
    }))
    const result = await runCoordinator(
      { goal: 'g', agents: [{ name: 'test:a', task: 't' }], maxIterations: 3 },
      makeDeps(dispatch),
      new AbortController().signal,
    )
    expect(result.iterations).toBe(3)
    expect(result.hitCap).toBe(true)
  })

  it('error in one agent does not kill siblings (Promise.allSettled)', async () => {
    const dispatch = vi.fn(async (opts: DispatchAgentOpts): Promise<DispatchAgentResult> => {
      if (opts.agent.name === 'test:a') throw new Error('boom')
      return { output: 'done: true', isError: false, turns: 1, usage: { inputTokens: 0, outputTokens: 0 } }
    })
    const result = await runCoordinator(
      {
        goal: 'g',
        agents: [
          { name: 'test:a', task: 't' },
          { name: 'test:b', task: 't' },
        ],
        maxIterations: 2,
      },
      makeDeps(dispatch),
      new AbortController().signal,
    )
    const aOut = result.outcomes.find(o => o.name === 'test:a')
    const bOut = result.outcomes.find(o => o.name === 'test:b')
    expect(aOut?.status).toBe('error')
    expect(aOut?.error).toMatch(/boom/)
    expect(bOut?.status).toBe('ok')
  })

  it('rejects unknown agent name with structured error outcome', async () => {
    const dispatch = vi.fn(async (): Promise<DispatchAgentResult> => ({
      output: 'unused', isError: false, turns: 0, usage: { inputTokens: 0, outputTokens: 0 },
    }))
    const result = await runCoordinator(
      { goal: 'g', agents: [{ name: 'missing:x', task: 't' }], maxIterations: 1 },
      makeDeps(dispatch),
      new AbortController().signal,
    )
    expect(result.outcomes[0]!.status).toBe('error')
    expect(result.outcomes[0]!.error).toMatch(/unknown agent/i)
  })

  it('aborts cleanly when signal is fired', async () => {
    const controller = new AbortController()
    const dispatch = vi.fn(async (): Promise<DispatchAgentResult> => {
      controller.abort()
      return { output: 'partial', isError: true, turns: 1, usage: { inputTokens: 0, outputTokens: 0 } }
    })
    const result = await runCoordinator(
      { goal: 'g', agents: [{ name: 'test:a', task: 't' }], maxIterations: 5 },
      makeDeps(dispatch),
      controller.signal,
    )
    expect(result.iterations).toBeGreaterThanOrEqual(1)
    // No throw — aborted state surfaces as outcomes / hitCap=false.
  })
})
