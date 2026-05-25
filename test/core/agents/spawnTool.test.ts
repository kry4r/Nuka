import { describe, expect, it } from 'vitest'
import { makeSpawnAgentTool, type SpawnAgentTaskManagerLike } from '../../../src/core/agents/spawnTool'
import { AgentRegistry } from '../../../src/core/agents/registry'
import { ToolRegistry } from '../../../src/core/tools/registry'
import type { LLMProvider } from '../../../src/core/provider/types'
import type { ProviderResolver } from '../../../src/core/provider/resolver'
import { PermissionChecker } from '../../../src/core/permission/checker'
import { PermissionCache } from '../../../src/core/permission/cache'
import { createSession } from '../../../src/core/session/session'
import { createHookRegistry } from '../../../src/core/hooks/registry'
import { createWorktreeStore } from '../../../src/core/worktree/store'
import type { ResolvedAgentDef } from '../../../src/core/agents/types'
import type { LocalAgentSpec, Task } from '../../../src/core/tasks/types'
import type { Message } from '../../../src/core/message/types'
import type { ProviderEvent } from '../../../src/core/provider/types'
import type { GitResult } from '../../../src/core/worktree/git'

function mkAgent(
  pluginName: string,
  name: string,
  description: string,
  overrides: Partial<ResolvedAgentDef> = {},
): ResolvedAgentDef {
  return {
    name,
    description,
    systemPrompt: 'system',
    maxTurns: 20,
    pluginName,
    ...overrides,
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

function mkRecordingProvider(requests: Message[][], replyText: string): LLMProvider {
  return {
    id: 'p',
    format: 'openai',
    async *stream(req) {
      requests.push(req.messages)
      yield { type: 'text_delta', text: replyText }
      yield { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } }
    },
    async listRemoteModels() { return [] },
  } as LLMProvider
}

function mkScriptProvider(scripts: ProviderEvent[][]): LLMProvider {
  let i = 0
  return {
    id: 'p',
    format: 'openai',
    async *stream() {
      const script = scripts[i++] ?? []
      for (const ev of script) yield ev
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

function fakeGitRunner(calls: string[][] = []) {
  return (args: string[], opts: { cwd: string }): GitResult => {
    calls.push([opts.cwd, ...args])
    if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
      return { code: 0, stdout: '/repo\n', stderr: '' }
    }
    if (args[0] === 'worktree' && args[1] === 'add') {
      return { code: 0, stdout: '', stderr: '' }
    }
    return { code: 1, stdout: '', stderr: 'unexpected git call' }
  }
}

function failingGitRootRunner(calls: string[][] = []) {
  return (args: string[], opts: { cwd: string }): GitResult => {
    calls.push([opts.cwd, ...args])
    return { code: 1, stdout: '', stderr: 'not a repo' }
  }
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
    expect(JSON.stringify(tool.parameters)).toContain('Fork')
    expect(JSON.stringify(tool.parameters)).not.toContain('summary-only')
    expect(JSON.stringify(tool.parameters)).not.toContain('Currently returns a clear unsupported error')
  })

  it('description hides agents whose required MCP servers are unavailable', () => {
    const agents = new AgentRegistry()
    agents.register(mkAgent('core', 'plain', 'available without MCP'))
    agents.register(mkAgent('core', 'github-worker', 'works with GitHub context', {
      requiredMcpServers: ['github'],
    }))
    agents.register(mkAgent('core', 'linear-worker', 'works with Linear context', {
      requiredMcpServers: ['linear'],
    }))
    const { deps } = makeDeps(agents)
    const tool = makeSpawnAgentTool({
      ...deps,
      availableMcpServers: () => ['project-github'],
    })

    expect(tool.description).toContain('core:plain')
    expect(tool.description).toContain('core:github-worker')
    expect(tool.description).not.toContain('core:linear-worker')
  })

  it('keeps required-MCP agents visible when no availability callback is supplied', () => {
    const agents = new AgentRegistry()
    agents.register(mkAgent('core', 'github-worker', 'works with GitHub context', {
      requiredMcpServers: ['github'],
    }))
    agents.register(mkAgent('core', 'linear-worker', 'works with Linear context', {
      requiredMcpServers: ['linear'],
    }))
    const { deps } = makeDeps(agents)
    const tool = makeSpawnAgentTool(deps)

    expect(tool.description).toContain('core:github-worker')
    expect(tool.description).toContain('core:linear-worker')
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

  it('rejects an agent hidden by required MCP server filtering without enqueueing', async () => {
    const agents = new AgentRegistry()
    agents.register(mkAgent('core', 'linear-worker', 'works with Linear context', {
      requiredMcpServers: ['linear'],
    }))
    const { deps, tasks } = makeDeps(agents)
    const tool = makeSpawnAgentTool({
      ...deps,
      availableMcpServers: () => ['github'],
    })
    const session = createSession({ providerId: 'p', model: 'm' })

    const result = await tool.run(
      { agent: 'core:linear-worker', task: 'review issue' },
      { signal: new AbortController().signal, cwd: process.cwd(), session },
    )

    expect(result.isError).toBe(true)
    expect(result.output as string).toContain("Unavailable agent 'core:linear-worker'")
    expect(result.output as string).toContain('requires MCP servers: linear')
    expect(tasks.specs).toHaveLength(0)
  })

  it('queues structured parent session fork messages when fork_context is true', async () => {
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
    expect(tasks.specs[0]?.forkContext).toEqual({ mode: 'structured' })
    expect(tasks.specs[0]?.forkMessages?.slice(0, 2)).toMatchObject([
      { role: 'user', content: [{ type: 'text', text: 'parent request' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'parent answer' }] },
    ])
    expect(tasks.specs[0]?.context).toBeUndefined()
    const directive = tasks.specs[0]?.forkMessages?.at(-1)
    const directiveText = directive?.role === 'user' && directive.content[0]?.type === 'text'
      ? directive.content[0].text
      : ''
    expect(directiveText).not.toContain('Forked parent context:')
    expect(directiveText).toContain('extra context')
    expect(result.output as string).toContain('fork=structured')
    expect(result.output as string).not.toContain('summary-only')
  })

  it('forked runner sends parent messages and stable placeholder tool results before the directive', async () => {
    const agents = new AgentRegistry()
    agents.register(mkAgent('core', 'reviewer', 'reviews code'))
    const requests: Message[][] = []
    const provider = mkRecordingProvider(requests, 'forked-response')
    const cache = new PermissionCache()
    const tasks = new FakeTaskManager()
    const tool = makeSpawnAgentTool({
      agents,
      registry: new ToolRegistry(),
      providerResolver: mkResolver(provider),
      permission: new PermissionChecker(() => cache, async () => ({ allowed: true })),
      taskManager: tasks,
    })
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
      content: [
        { type: 'text', text: 'I will fork two checks.' },
        { type: 'tool_use', id: 'call-1', name: 'spawn_agent', input: { agent: 'core:reviewer', task: 'check A', fork_context: true } },
        { type: 'tool_use', id: 'call-2', name: 'spawn_agent', input: { agent: 'core:reviewer', task: 'check B', fork_context: true } },
      ],
    })

    const result = await tool.run(
      { agent: 'core:reviewer', task: 'review only auth files', context: 'extra facts', fork_context: true },
      { signal: new AbortController().signal, cwd: process.cwd(), session },
    )

    expect(result.isError).toBe(false)
    for await (const _chunk of tasks.specs[0]!.agentRunner(new AbortController().signal)) {
      // drain
    }
    expect(requests).toHaveLength(1)
    const messages = requests[0]!
    expect(messages.map(m => m.role)).toEqual(['user', 'assistant', 'tool', 'tool', 'user'])
    expect(messages[0]).toMatchObject({ role: 'user', content: [{ type: 'text', text: 'parent request' }] })
    expect(messages[1]).toMatchObject({ role: 'assistant' })
    expect(messages[2]).toMatchObject({
      role: 'tool',
      toolUseId: 'call-1',
      content: 'F',
      isError: false,
    })
    expect(messages[3]).toMatchObject({
      role: 'tool',
      toolUseId: 'call-2',
      content: 'F',
      isError: false,
    })
    const directive = messages[4]
    expect(directive).toMatchObject({ role: 'user' })
    expect(directive.role === 'user' ? directive.content[0]?.type : undefined).toBe('text')
    const text = directive.role === 'user' && directive.content[0]?.type === 'text'
      ? directive.content[0].text
      : ''
    expect(text).toContain('Fork')
    expect(text).toContain('review only auth files')
    expect(text).toContain('extra facts')
  })

  it('does not add placeholder tool results for already-resolved earlier assistant calls', async () => {
    const agents = new AgentRegistry()
    agents.register(mkAgent('core', 'reviewer', 'reviews code'))
    const requests: Message[][] = []
    const provider = mkRecordingProvider(requests, 'forked-response')
    const tasks = new FakeTaskManager()
    const tool = makeSpawnAgentTool({
      agents,
      registry: new ToolRegistry(),
      providerResolver: mkResolver(provider),
      permission: new PermissionChecker(() => new PermissionCache(), async () => ({ allowed: true })),
      taskManager: tasks,
    })
    const session = createSession({ providerId: 'p', model: 'm' })
    session.messages.push({
      role: 'assistant',
      id: 'a1',
      ts: 1,
      content: [
        { type: 'tool_use', id: 'old-call', name: 'Read', input: { path: 'src/a.ts' } },
      ],
    })
    session.messages.push({
      role: 'tool',
      id: 't1',
      ts: 2,
      toolUseId: 'old-call',
      content: 'old result',
      isError: false,
    })
    session.messages.push({
      role: 'user',
      id: 'u1',
      ts: 3,
      content: [{ type: 'text', text: 'parent follow-up after tool result' }],
    })

    await tool.run(
      { agent: 'core:reviewer', task: 'review latest state', fork_context: true },
      { signal: new AbortController().signal, cwd: process.cwd(), session },
    )

    for await (const _chunk of tasks.specs[0]!.agentRunner(new AbortController().signal)) {
      // drain
    }

    expect(requests[0]!.map(m => m.role)).toEqual(['assistant', 'tool', 'user', 'user'])
    expect(requests[0]!.filter(m =>
      m.role === 'tool' && m.content === 'F',
    )).toHaveLength(0)
  })

  it('accepts write_scope and includes it in the queued local_agent context', async () => {
    const agents = new AgentRegistry()
    agents.register(mkAgent('core', 'reviewer', 'reviews code'))
    const { deps, tasks } = makeDeps(agents)
    const tool = makeSpawnAgentTool(deps)
    const session = createSession({ providerId: 'p', model: 'm' })

    const result = await tool.run(
      {
        agent: 'core:reviewer',
        task: 'review this',
        context: 'extra context',
        write_scope: {
          allow: [' src/core/agents ', 'test/core/agents'],
          deny: ['docs/plans '],
          note: 'Do not edit roadmap docs from this worker.',
        },
      },
      { signal: new AbortController().signal, cwd: process.cwd(), session },
    )

    expect(result.isError).toBe(false)
    expect(tasks.specs[0]?.writeScope).toEqual({
      allow: ['src/core/agents', 'test/core/agents'],
      deny: ['docs/plans'],
      note: 'Do not edit roadmap docs from this worker.',
    })
    expect(tasks.specs[0]?.context).toContain('Write scope:')
    expect(tasks.specs[0]?.context).toContain('- Allowed paths: src/core/agents, test/core/agents')
    expect(tasks.specs[0]?.context).toContain('- Denied paths: docs/plans')
    expect(tasks.specs[0]?.context).toContain('- Note: Do not edit roadmap docs from this worker.')
    expect(tasks.specs[0]?.context).toContain('extra context')
  })

  it('rejects write_scope path lists with empty entries', async () => {
    const agents = new AgentRegistry()
    agents.register(mkAgent('core', 'reviewer', 'reviews code'))
    const { deps, tasks } = makeDeps(agents)
    const tool = makeSpawnAgentTool(deps)
    const session = createSession({ providerId: 'p', model: 'm' })

    const result = await tool.run(
      {
        agent: 'core:reviewer',
        task: 'review this',
        write_scope: {
          allow: ['src/core/agents', '   '],
        },
      },
      { signal: new AbortController().signal, cwd: process.cwd(), session },
    )

    expect(result.isError).toBe(true)
    expect(result.output as string).toContain('write_scope.allow contains an empty path')
    expect(tasks.specs).toHaveLength(0)
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

  it('spawned runner inherits lifecycle hooks and active worktree cwd', async () => {
    const agents = new AgentRegistry()
    agents.register(mkAgent('core', 'reviewer', 'reviews code'))
    const cwdSeen: string[] = []
    const registry = new ToolRegistry()
    registry.register({
      name: 'PeekCwd',
      description: 'peek cwd',
      parameters: { type: 'object', properties: {} },
      source: 'builtin',
      tags: ['core'],
      needsPermission: () => 'none',
      run: async (_input, ctx) => {
        cwdSeen.push(ctx.cwd)
        return { output: 'cwd-ok', isError: false }
      },
    })
    const provider = mkScriptProvider([
      [
        { type: 'tool_use_start', id: 'cwd-1', name: 'PeekCwd' },
        { type: 'tool_use_stop', id: 'cwd-1', input: {} },
        { type: 'message_stop', stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1 } },
      ],
      [
        { type: 'text_delta', text: 'done' },
        { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } },
      ],
    ])
    const hookRegistry = createHookRegistry()
    const hookContexts: string[] = []
    hookRegistry.register('sessionStart', (hookCtx) => {
      const payload = hookCtx.payload as { context?: string; cwd?: string }
      hookContexts.push(`${payload.context}:${payload.cwd}`)
    })
    const worktreeStore = createWorktreeStore()
    const active = worktreeStore.add({
      path: '/tmp/nuka-spawn-worktree',
      originalCwd: process.cwd(),
    })
    worktreeStore.setActive(active.id)
    const cache = new PermissionCache()
    const tasks = new FakeTaskManager()
    const tool = makeSpawnAgentTool({
      agents,
      registry,
      providerResolver: mkResolver(provider),
      permission: new PermissionChecker(() => cache, async () => ({ allowed: true })),
      taskManager: tasks,
      hookRegistry,
      worktreeStore,
    })
    const session = createSession({ providerId: 'p', model: 'm' })

    const result = await tool.run(
      { agent: 'core:reviewer', task: 'check cwd' },
      { signal: new AbortController().signal, cwd: process.cwd(), session },
    )

    expect(result.isError).toBe(false)
    const chunks: string[] = []
    for await (const chunk of tasks.specs[0]!.agentRunner(new AbortController().signal)) {
      chunks.push(chunk.text)
    }
    expect(chunks.join('')).toContain('done')
    expect(tasks.specs[0]).toMatchObject({
      cwd: '/tmp/nuka-spawn-worktree',
    })
    expect(hookContexts).toEqual(['subagent:/tmp/nuka-spawn-worktree'])
    expect(cwdSeen).toEqual(['/tmp/nuka-spawn-worktree'])
  })

  it('spawned runner keeps the captured cwd even if the active worktree changes before execution', async () => {
    const agents = new AgentRegistry()
    agents.register(mkAgent('core', 'reviewer', 'reviews code'))
    const cwdSeen: string[] = []
    const registry = new ToolRegistry()
    registry.register({
      name: 'PeekCwd',
      description: 'peek cwd',
      parameters: { type: 'object', properties: {} },
      source: 'builtin',
      tags: ['core'],
      needsPermission: () => 'none',
      run: async (_input, ctx) => {
        cwdSeen.push(ctx.cwd)
        return { output: 'cwd-ok', isError: false }
      },
    })
    const provider = mkScriptProvider([
      [
        { type: 'tool_use_start', id: 'cwd-1', name: 'PeekCwd' },
        { type: 'tool_use_stop', id: 'cwd-1', input: {} },
        { type: 'message_stop', stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1 } },
      ],
      [
        { type: 'text_delta', text: 'done' },
        { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } },
      ],
    ])
    const worktreeStore = createWorktreeStore()
    const first = worktreeStore.add({
      path: '/tmp/nuka-first-worktree',
      originalCwd: process.cwd(),
    })
    const second = worktreeStore.add({
      path: '/tmp/nuka-second-worktree',
      originalCwd: process.cwd(),
    })
    worktreeStore.setActive(first.id)
    const cache = new PermissionCache()
    const tasks = new FakeTaskManager()
    const tool = makeSpawnAgentTool({
      agents,
      registry,
      providerResolver: mkResolver(provider),
      permission: new PermissionChecker(() => cache, async () => ({ allowed: true })),
      taskManager: tasks,
      worktreeStore,
    })
    const session = createSession({ providerId: 'p', model: 'm' })

    await tool.run(
      { agent: 'core:reviewer', task: 'check cwd' },
      { signal: new AbortController().signal, cwd: process.cwd(), session },
    )
    expect(tasks.specs[0]?.cwd).toBe('/tmp/nuka-first-worktree')

    worktreeStore.setActive(second.id)
    for await (const _chunk of tasks.specs[0]!.agentRunner(new AbortController().signal)) {
      // drain
    }

    expect(cwdSeen).toEqual(['/tmp/nuka-first-worktree'])
  })

  it('creates an isolated worktree for a spawned background agent when requested', async () => {
    const agents = new AgentRegistry()
    agents.register(mkAgent('core', 'reviewer', 'reviews code'))
    const cwdSeen: string[] = []
    const registry = new ToolRegistry()
    registry.register({
      name: 'PeekCwd',
      description: 'peek cwd',
      parameters: { type: 'object', properties: {} },
      source: 'builtin',
      tags: ['core'],
      needsPermission: () => 'none',
      run: async (_input, ctx) => {
        cwdSeen.push(ctx.cwd)
        return { output: 'cwd-ok', isError: false }
      },
    })
    const provider = mkScriptProvider([
      [
        { type: 'tool_use_start', id: 'cwd-1', name: 'PeekCwd' },
        { type: 'tool_use_stop', id: 'cwd-1', input: {} },
        { type: 'message_stop', stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1 } },
      ],
      [
        { type: 'text_delta', text: 'done' },
        { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } },
      ],
    ])
    const gitCalls: string[][] = []
    const worktreeStore = createWorktreeStore()
    const tasks = new FakeTaskManager()
    const tool = makeSpawnAgentTool({
      agents,
      registry,
      providerResolver: mkResolver(provider),
      permission: new PermissionChecker(() => new PermissionCache(), async () => ({ allowed: true })),
      taskManager: tasks,
      worktreeStore,
      gitRunner: fakeGitRunner(gitCalls),
    })
    const session = createSession({ providerId: 'p', model: 'm' })

    const result = await tool.run(
      {
        agent: 'core:reviewer',
        task: 'check isolated cwd',
        isolation: 'worktree',
        worktree_name: 'review branch',
      },
      { signal: new AbortController().signal, cwd: '/repo', session },
    )

    expect(result.isError).toBe(false)
    expect(gitCalls).toContainEqual(['/repo', 'rev-parse', '--show-toplevel'])
    expect(gitCalls).toContainEqual([
      '/repo',
      'worktree',
      'add',
      '-b',
      'review-branch',
      '/repo/.nuka/worktrees/review-branch',
    ])
    expect(worktreeStore.getActive()).toBeUndefined()
    expect(worktreeStore.list()).toHaveLength(1)
    expect(tasks.specs[0]).toMatchObject({
      cwd: '/repo/.nuka/worktrees/review-branch',
      worktree: ['/repo/.nuka/worktrees/review-branch', '/repo'],
    })
    expect(tasks.specs[0]?.gitRunner).toBeTypeOf('function')
    expect(result.output as string).toContain('worktree=/repo/.nuka/worktrees/review-branch')

    for await (const _chunk of tasks.specs[0]!.agentRunner(new AbortController().signal)) {
      // drain
    }
    expect(cwdSeen).toEqual(['/repo/.nuka/worktrees/review-branch'])
  })

  it('adds a path-translation notice to structured forks created in isolated worktrees', async () => {
    const agents = new AgentRegistry()
    agents.register(mkAgent('core', 'reviewer', 'reviews code'))
    const gitCalls: string[][] = []
    const worktreeStore = createWorktreeStore()
    const tasks = new FakeTaskManager()
    const tool = makeSpawnAgentTool({
      agents,
      registry: new ToolRegistry(),
      providerResolver: mkResolver(mkProvider('unused')),
      permission: new PermissionChecker(() => new PermissionCache(), async () => ({ allowed: true })),
      taskManager: tasks,
      worktreeStore,
      gitRunner: fakeGitRunner(gitCalls),
    })
    const session = createSession({ providerId: 'p', model: 'm' })
    session.messages.push({
      role: 'user',
      id: 'u1',
      ts: 1,
      content: [{ type: 'text', text: 'parent saw src/app.ts in /repo' }],
    })

    const result = await tool.run(
      {
        agent: 'core:reviewer',
        task: 'review the parent path references',
        fork_context: true,
        isolation: 'worktree',
        worktree_name: 'review branch',
      },
      { signal: new AbortController().signal, cwd: '/repo', session },
    )

    expect(result.isError).toBe(false)
    const directive = tasks.specs[0]?.forkMessages?.at(-1)
    const directiveText = directive?.role === 'user' && directive.content[0]?.type === 'text'
      ? directive.content[0].text
      : ''
    expect(directiveText).toContain('review the parent path references')
    expect(directiveText).toContain('parent=/repo')
    expect(directiveText).toContain('cwd=/repo/.nuka/worktrees/review-branch')
    expect(directiveText).toContain('Translate paths')
    expect(directiveText).toContain('re-read')
    expect(directiveText).toContain('isolate edits')
  })

  it('inherits worktree isolation from the agent definition', async () => {
    const agents = new AgentRegistry()
    agents.register(mkAgent('core', 'worker', 'implements code', { isolation: 'worktree' }))
    const gitCalls: string[][] = []
    const worktreeStore = createWorktreeStore()
    const tasks = new FakeTaskManager()
    const tool = makeSpawnAgentTool({
      agents,
      registry: new ToolRegistry(),
      providerResolver: mkResolver(mkProvider('unused')),
      permission: new PermissionChecker(() => new PermissionCache(), async () => ({ allowed: true })),
      taskManager: tasks,
      worktreeStore,
      gitRunner: fakeGitRunner(gitCalls),
    })
    const session = createSession({ providerId: 'p', model: 'm' })

    const result = await tool.run(
      {
        agent: 'core:worker',
        task: 'Implement isolated default',
      },
      { signal: new AbortController().signal, cwd: '/repo', session },
    )

    expect(result.isError).toBe(false)
    expect(gitCalls).toContainEqual([
      '/repo',
      'worktree',
      'add',
      '-b',
      'implement-isolated-default',
      '/repo/.nuka/worktrees/implement-isolated-default',
    ])
    expect(tasks.specs[0]?.cwd).toBe('/repo/.nuka/worktrees/implement-isolated-default')
    expect(result.output as string).toContain('worktree=/repo/.nuka/worktrees/implement-isolated-default')
  })

  it('lets spawn_agent override an agent definition worktree default with inherit', async () => {
    const agents = new AgentRegistry()
    agents.register(mkAgent('core', 'worker', 'implements code', { isolation: 'worktree' }))
    const gitCalls: string[][] = []
    const worktreeStore = createWorktreeStore()
    const active = worktreeStore.add({
      path: '/repo/.nuka/worktrees/current',
      originalCwd: '/repo',
    })
    worktreeStore.setActive(active.id)
    const tasks = new FakeTaskManager()
    const tool = makeSpawnAgentTool({
      agents,
      registry: new ToolRegistry(),
      providerResolver: mkResolver(mkProvider('unused')),
      permission: new PermissionChecker(() => new PermissionCache(), async () => ({ allowed: true })),
      taskManager: tasks,
      worktreeStore,
      gitRunner: fakeGitRunner(gitCalls),
    })
    const session = createSession({ providerId: 'p', model: 'm' })

    const result = await tool.run(
      {
        agent: 'core:worker',
        task: 'Implement in current checkout',
        isolation: 'inherit',
      },
      { signal: new AbortController().signal, cwd: '/repo', session },
    )

    expect(result.isError).toBe(false)
    expect(gitCalls).toEqual([])
    expect(tasks.specs[0]?.cwd).toBe('/repo/.nuka/worktrees/current')
    expect(result.output as string).not.toContain('worktree=')
  })

  it('rejects worktree isolation without a worktree store', async () => {
    const agents = new AgentRegistry()
    agents.register(mkAgent('core', 'reviewer', 'reviews code'))
    const tasks = new FakeTaskManager()
    const tool = makeSpawnAgentTool({
      agents,
      registry: new ToolRegistry(),
      providerResolver: mkResolver(mkProvider('unused')),
      permission: new PermissionChecker(() => new PermissionCache(), async () => ({ allowed: true })),
      taskManager: tasks,
    })
    const session = createSession({ providerId: 'p', model: 'm' })

    const result = await tool.run(
      {
        agent: 'core:reviewer',
        task: 'check isolated cwd',
        isolation: 'worktree',
      },
      { signal: new AbortController().signal, cwd: '/repo', session },
    )

    expect(result.isError).toBe(true)
    expect(result.output as string).toContain('requires a worktree store')
    expect(tasks.specs).toHaveLength(0)
  })

  it('rejects worktree isolation outside a git repo without enqueueing', async () => {
    const agents = new AgentRegistry()
    agents.register(mkAgent('core', 'reviewer', 'reviews code'))
    const gitCalls: string[][] = []
    const tasks = new FakeTaskManager()
    const tool = makeSpawnAgentTool({
      agents,
      registry: new ToolRegistry(),
      providerResolver: mkResolver(mkProvider('unused')),
      permission: new PermissionChecker(() => new PermissionCache(), async () => ({ allowed: true })),
      taskManager: tasks,
      worktreeStore: createWorktreeStore(),
      gitRunner: failingGitRootRunner(gitCalls),
    })
    const session = createSession({ providerId: 'p', model: 'm' })

    const result = await tool.run(
      {
        agent: 'core:reviewer',
        task: 'check isolated cwd',
        isolation: 'worktree',
      },
      { signal: new AbortController().signal, cwd: '/not-repo', session },
    )

    expect(result.isError).toBe(true)
    expect(result.output as string).toContain('requires a git repo')
    expect(gitCalls).toEqual([['/not-repo', 'rev-parse', '--show-toplevel']])
    expect(tasks.specs).toHaveLength(0)
  })
})
