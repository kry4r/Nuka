import { describe, expect, it } from 'vitest'
import { makeSpawnAgentTool, type SpawnAgentTaskManagerLike } from '../../../src/core/agents/spawnTool'
import { AgentRegistry } from '../../../src/core/agents/registry'
import { ToolRegistry } from '../../../src/core/tools/registry'
import type { LLMProvider } from '../../../src/core/provider/types'
import type { ProviderResolver } from '../../../src/core/provider/resolver'
import { PermissionChecker } from '../../../src/core/permission/checker'
import { PermissionCache } from '../../../src/core/permission/cache'
import { createSession } from '../../../src/core/session/session'
import type { ResolvedAgentDef } from '../../../src/core/agents/types'
import type { LocalAgentSpec, Task } from '../../../src/core/tasks/types'

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

class FakeTaskManager implements SpawnAgentTaskManagerLike {
  readonly specs: LocalAgentSpec[] = []

  enqueue(spec: LocalAgentSpec): Task {
    this.specs.push(spec)
    const index = this.specs.length
    const id = `task-${index}`
    return {
      id,
      kind: 'local_agent',
      description: spec.description,
      state: 'running',
      outputFile: `/tmp/${id}.log`,
      agentId: spec.agentId ?? `agent-${id}`,
      spec,
    }
  }
}

describe('makeSpawnAgentTool', () => {
  function makeDeps(agents: AgentRegistry, tasks = new FakeTaskManager()) {
    const provider = mkProvider('spawned-response')
    const cache = new PermissionCache()
    return {
      tasks,
      deps: {
        agents,
        registry: new ToolRegistry(),
        providerResolver: mkResolver(provider),
        permission: new PermissionChecker(() => cache, async () => ({ allowed: true })),
        taskManager: tasks,
      },
    }
  }

  it('registers as a background-spawning task tool', () => {
    const tool = makeSpawnAgentTool(makeDeps(new AgentRegistry()).deps)
    expect(tool.name).toBe('spawn_agent')
    expect(tool.tags).toContain('core')
    expect(tool.tags).toContain('agent')
    expect(tool.tags).toContain('tasks')
    expect(tool.annotations?.readOnly).toBe(false)
    expect(tool.needsPermission({ agent: 'core:reviewer', task: 'review' })).toBe('none')
  })

  it('enqueues a local_agent task and returns stable lookup ids', async () => {
    const agents = new AgentRegistry()
    agents.register(mkAgent('core', 'reviewer', 'reviews code'))
    const { deps, tasks } = makeDeps(agents)
    const tool = makeSpawnAgentTool(deps)
    const session = createSession({ providerId: 'p', model: 'm' })

    const result = await tool.run(
      {
        agent: 'core:reviewer',
        task: 'review this',
        description: 'review task',
      },
      { signal: new AbortController().signal, cwd: process.cwd(), session },
    )

    expect(result.isError).toBe(false)
    expect(tasks.specs).toHaveLength(1)
    expect(tasks.specs[0]?.kind).toBe('local_agent')
    expect(tasks.specs[0]?.description).toBe('review task')
    expect(tasks.specs[0]?.agentName).toBe('core:reviewer')
    expect(tasks.specs[0]?.task).toBe('review this')
    expect(tasks.specs[0]?.providerId).toBe('p')
    expect(tasks.specs[0]?.model).toBe('m')
    const output = result.output as string
    expect(output).toContain('status=spawned')
    expect(output).toContain('task_id=task-1')
    expect(output).toContain('agent_id=agent-task-1')
    expect(output).toContain('agent=core:reviewer')
    expect(output).toContain('output_file=/tmp/task-1.log')
  })

  it('runs the queued agent through dispatchAgent', async () => {
    const agents = new AgentRegistry()
    agents.register(mkAgent('core', 'reviewer', 'reviews code'))
    const { deps, tasks } = makeDeps(agents)
    const tool = makeSpawnAgentTool(deps)
    const session = createSession({ providerId: 'p', model: 'm' })

    await tool.run(
      { agent: 'core:reviewer', task: 'review this' },
      { signal: new AbortController().signal, cwd: process.cwd(), session },
    )

    const runner = tasks.specs[0]?.agentRunner
    expect(runner).toBeTypeOf('function')
    const chunks: string[] = []
    for await (const chunk of runner!(new AbortController().signal)) {
      chunks.push(chunk.text)
    }
    expect(chunks.join('')).toContain('spawned-response')
  })

  it('returns a structured error for unknown agents without enqueueing', async () => {
    const { deps, tasks } = makeDeps(new AgentRegistry())
    const tool = makeSpawnAgentTool(deps)
    const session = createSession({ providerId: 'p', model: 'm' })

    const result = await tool.run(
      { agent: 'missing:one', task: 'review this' },
      { signal: new AbortController().signal, cwd: process.cwd(), session },
    )

    expect(result.isError).toBe(true)
    expect(result.output as string).toContain("Unknown agent 'missing:one'")
    expect(tasks.specs).toHaveLength(0)
  })

  it('injects parent session context when fork_context is true', async () => {
    const agents = new AgentRegistry()
    agents.register(mkAgent('core', 'reviewer', 'reviews code'))
    const { deps, tasks } = makeDeps(agents)
    const tool = makeSpawnAgentTool(deps)
    const session = createSession({ providerId: 'p', model: 'm' })
    session.messages.push({
      role: 'user',
      id: 'u1',
      ts: 1,
      content: [{ type: 'text', text: 'parent request' }],
    })
    session.messages.push({
      role: 'assistant',
      id: 'a1',
      ts: 2,
      content: [{ type: 'text', text: 'parent answer' }],
    })

    const result = await tool.run(
      { agent: 'core:reviewer', task: 'review this', context: 'extra context', fork_context: true },
      { signal: new AbortController().signal, cwd: process.cwd(), session },
    )

    expect(result.isError).toBe(false)
    expect(tasks.specs).toHaveLength(1)
    expect(tasks.specs[0]?.context).toContain('Forked parent context:')
    expect(tasks.specs[0]?.context).toContain('user: parent request')
    expect(tasks.specs[0]?.context).toContain('assistant: parent answer')
    expect(tasks.specs[0]?.context).toContain('extra context')
  })

  it('recursion guard: refuses inside a sub-agent session', async () => {
    const agents = new AgentRegistry()
    agents.register(mkAgent('core', 'reviewer', 'reviews code'))
    const { deps, tasks } = makeDeps(agents)
    const tool = makeSpawnAgentTool(deps)
    const session = createSession({ providerId: 'p', model: 'm' })
    session.allowedAgentDispatch = false

    const result = await tool.run(
      { agent: 'core:reviewer', task: 'review this' },
      { signal: new AbortController().signal, cwd: process.cwd(), session },
    )

    expect(result.isError).toBe(true)
    expect(result.output as string).toContain('Sub-agents cannot spawn further sub-agents')
    expect(tasks.specs).toHaveLength(0)
  })
})
