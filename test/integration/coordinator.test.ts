import { describe, it, expect } from 'vitest'
import { runCoordinator } from '../../src/core/agents/coordinator/coordinator'
import { AgentRegistry } from '../../src/core/agents/registry'
import { ToolRegistry } from '../../src/core/tools/registry'
import type { ResolvedAgentDef } from '../../src/core/agents/types'
import type { DispatchAgentOpts, DispatchAgentResult } from '../../src/core/agents/dispatch'

const agent = (name: string): ResolvedAgentDef => ({
  name, description: 'd', systemPrompt: 'sp', pluginName: 'p', maxTurns: 20,
})

describe('B5 — coordinator end-to-end (mocked dispatch)', () => {
  it('two agents exchange via blackboard across iterations', async () => {
    const agents = new AgentRegistry()
    agents.register(agent('writer'))
    agents.register(agent('reader'))

    let iteration = 0
    const dispatch = async (opts: DispatchAgentOpts): Promise<DispatchAgentResult> => {
      if (opts.agent.name === 'p:writer') {
        const w = opts.registry.find('bb_write')!
        await w.run({ key: 'note', value: 'hello' }, { signal: opts.signal, cwd: process.cwd() })
        return { output: 'done: true', isError: false, turns: 1, usage: { inputTokens: 0, outputTokens: 0 } }
      }
      // reader: not done until it has seen the note (one extra iteration)
      const r = opts.registry.find('bb_read')!
      const got = await r.run({ key: 'note' }, { signal: opts.signal, cwd: process.cwd() })
      const value = typeof got.output === 'string' ? got.output : ''
      iteration++
      if (value.length === 0) {
        return { output: 'waiting', isError: false, turns: 1, usage: { inputTokens: 0, outputTokens: 0 } }
      }
      return { output: `saw ${value}\ndone: true`, isError: false, turns: 1, usage: { inputTokens: 0, outputTokens: 0 } }
    }

    const result = await runCoordinator(
      {
        goal: 'exchange note',
        agents: [{ name: 'p:writer', task: 'write note' }, { name: 'p:reader', task: 'read note' }],
        maxIterations: 4,
      },
      {
        dispatch,
        agents,
        registry: new ToolRegistry(),
        providerResolver: { listProviders: () => [{ id: 'x' }] } as never,
        permission: { check: async () => ({ allowed: true }) } as never,
      },
      new AbortController().signal,
    )

    expect(result.blackboard.note).toBe('hello')
    expect(result.hitCap).toBe(false)
    expect(result.outcomes.every(o => o.status === 'ok')).toBe(true)
    expect(result.iterations).toBeLessThanOrEqual(4)
  })
})
