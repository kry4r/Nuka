import { describe, expect, it, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { makeWaitAgentTool, makeCloseAgentTool, makeResumeAgentTool, makeSendAgentTool, makeSendInputTool } from '../../../src/core/agents/agentLifecycleTools'
import type { Tool, ToolContext, ToolResult } from '../../../src/core/tools/types'
import type { LocalAgentSpec, Task } from '../../../src/core/tasks/types'
import { writeMeta, writeTranscript } from '../../../src/core/tasks/meta'
import { AgentRegistry } from '../../../src/core/agents/registry'
import { ToolRegistry } from '../../../src/core/tools/registry'
import type { ResolvedAgentDef } from '../../../src/core/agents/types'
import type { LLMProvider, ProviderEvent } from '../../../src/core/provider/types'
import type { ProviderResolver } from '../../../src/core/provider/resolver'
import { PermissionChecker } from '../../../src/core/permission/checker'
import { PermissionCache } from '../../../src/core/permission/cache'
import type { Skill } from '../../../src/core/skill/types'

const ctx = (): ToolContext => ({
  signal: new AbortController().signal,
  cwd: process.cwd(),
})

function makeDelegate<I>(name: string): Tool<I> & { calls: I[] } {
  const calls: I[] = []
  return {
    name,
    description: 'delegate',
    parameters: { type: 'object', properties: {} },
    source: 'builtin',
    tags: ['core'],
    needsPermission: () => 'none',
    run: async (input: I): Promise<ToolResult> => {
      calls.push(input)
      return { isError: false, output: `${name} ok` }
    },
    calls,
  }
}

function mkAgent(
  pluginName: string,
  name: string,
  overrides: Partial<ResolvedAgentDef> = {},
): ResolvedAgentDef {
  return {
    name,
    description: 'agent',
    systemPrompt: 'system',
    maxTurns: 20,
    pluginName,
    ...overrides,
  }
}

function mkSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: 'test-first',
    description: 'test first',
    when: 'on-session-start',
    body: 'Always write the regression test first.',
    source: 'project',
    path: '/tmp/test-first/SKILL.md',
    ...overrides,
  }
}

function mkProvider(seenPrompts: string[]): LLMProvider {
  return {
    id: 'p',
    format: 'openai',
    async *stream(req) {
      const user = req.messages.find(m => m.role === 'user')
      if (user?.role === 'user') {
        seenPrompts.push(user.content.map(b => b.type === 'text' ? b.text : '').join(''))
      }
      yield { type: 'text_delta', text: 'resumed-response' }
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

describe('agent lifecycle wrapper tools', () => {
  let home: string
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-resume-agent-'))
  })

  it('wait_agent delegates to TaskOutput with block=true and agent_id', async () => {
    const outputTool = makeDelegate<Record<string, unknown>>('TaskOutput')
    const tool = makeWaitAgentTool(outputTool)

    expect(tool.name).toBe('wait_agent')
    expect(tool.tags).toContain('agent')
    expect(tool.tags).toContain('tasks')
    expect(tool.annotations?.readOnly).toBe(true)

    const result = await tool.run(
      { agent_id: 'agent-123', timeout_ms: 2500, lines: 25 },
      ctx(),
    )

    expect(result.isError).toBe(false)
    expect(result.output).toBe('TaskOutput ok')
    expect(outputTool.calls).toEqual([
      {
        agent_id: 'agent-123',
        block: true,
        timeout_ms: 2500,
        lines: 25,
      },
    ])
  })

  it('wait_agent supports task_id as a compatibility escape hatch', async () => {
    const outputTool = makeDelegate<Record<string, unknown>>('TaskOutput')
    const tool = makeWaitAgentTool(outputTool)

    await tool.run(
      { task_id: 'task-1', timeout_ms: 0 },
      ctx(),
    )

    expect(outputTool.calls).toEqual([
      {
        task_id: 'task-1',
        block: true,
        timeout_ms: 0,
      },
    ])
  })

  it('close_agent delegates to TaskStop by agent_id', async () => {
    const stopTool = makeDelegate<Record<string, unknown>>('TaskStop')
    const tool = makeCloseAgentTool(stopTool)

    expect(tool.name).toBe('close_agent')
    expect(tool.tags).toContain('agent')
    expect(tool.tags).toContain('tasks')
    expect(tool.annotations?.readOnly).toBe(false)

    const result = await tool.run({ agent_id: 'agent-123' }, ctx())

    expect(result.isError).toBe(false)
    expect(result.output).toBe('TaskStop ok')
    expect(stopTool.calls).toEqual([{ agent_id: 'agent-123' }])
  })

  it('close_agent supports task_id as a compatibility escape hatch', async () => {
    const stopTool = makeDelegate<Record<string, unknown>>('TaskStop')
    const tool = makeCloseAgentTool(stopTool)

    await tool.run({ task_id: 'task-1' }, ctx())

    expect(stopTool.calls).toEqual([{ task_id: 'task-1' }])
  })

  it('resume_agent enqueues a new local_agent execution for the newest matching agent_id', async () => {
    const specs: LocalAgentSpec[] = []
    const existing: Task = {
      id: 'task-1',
      kind: 'local_agent',
      description: 'core:reviewer: original',
      state: 'completed',
      outputFile: '/tmp/task-1.log',
      agentId: 'agent-123',
      spec: {
        kind: 'local_agent',
        agentId: 'agent-123',
        agentName: 'core:reviewer',
        task: 'original',
        context: 'old context',
        writeScope: {
          allow: ['src/core/agents'],
          deny: ['docs/plans'],
          note: 'Keep edits in the runtime files.',
        },
        description: 'core:reviewer: original',
        agentRunner: async function* () { yield { text: 'old' } },
      },
    }
    const manager = {
      get: (id: string) => id === existing.id ? existing : undefined,
      list: () => [existing],
      enqueue: (spec: LocalAgentSpec): Task => {
        specs.push(spec)
        return {
          id: 'task-2',
          kind: 'local_agent',
          description: spec.description,
          state: 'running',
          outputFile: '/tmp/task-2.log',
          agentId: spec.agentId ?? 'agent-task-2',
          spec,
        }
      },
    }
    const agents = new AgentRegistry()
    agents.register(mkAgent('core', 'reviewer'))
    const tool = makeResumeAgentTool({
      taskManager: manager,
      agents,
      registry: new ToolRegistry(),
      providerResolver: mkResolver(mkProvider([])),
      permission: new PermissionChecker(() => new PermissionCache(), async () => ({ allowed: true })),
    })

    const result = await tool.run({
      agent_id: 'agent-123',
      prompt: 'continue from here',
      context: 'new facts',
    }, ctx())

    expect(result.isError).toBe(false)
    expect(specs).toHaveLength(1)
    expect(specs[0]).toMatchObject({
      kind: 'local_agent',
      agentId: 'agent-123',
      agentName: 'core:reviewer',
      task: 'continue from here',
      writeScope: {
        allow: ['src/core/agents'],
        deny: ['docs/plans'],
        note: 'Keep edits in the runtime files.',
      },
      resumed: true,
      providerId: undefined,
      model: undefined,
    })
    expect(specs[0]!.context).toContain('old context')
    expect(specs[0]!.context).toContain('Write scope:')
    expect(specs[0]!.context).toContain('- Allowed paths: src/core/agents')
    expect(specs[0]!.context).toContain('- Denied paths: docs/plans')
    expect(specs[0]!.context).toContain('- Note: Keep edits in the runtime files.')
    expect(specs[0]!.context).toContain('new facts')
    expect(specs[0]!.description).toBe('core:reviewer: continue from here')
    expect(result.output as string).toContain('status=resumed')
    expect(result.output as string).toContain('task_id=task-2')
    expect(result.output as string).toContain('agent_id=agent-123')
    expect(result.output as string).toContain('agent=core:reviewer')
    expect(result.output as string).toContain('resumed_from=task-1')
  })

  it('resume_agent rejects unknown agent ids without enqueueing', async () => {
    const manager = {
      get: () => undefined,
      list: () => [],
      enqueue: () => {
        throw new Error('should not enqueue')
      },
    }
    const tool = makeResumeAgentTool({
      taskManager: manager,
      agents: new AgentRegistry(),
      registry: new ToolRegistry(),
      providerResolver: mkResolver(mkProvider([])),
      permission: new PermissionChecker(() => new PermissionCache(), async () => ({ allowed: true })),
    })

    const result = await tool.run({ agent_id: 'missing', prompt: 'continue' }, ctx())

    expect(result.isError).toBe(true)
    expect(result.output as string).toContain("No background task with agent id 'missing'")
  })

  it('send_agent accepts message and enqueues a follow-up under the same agent_id', async () => {
    const specs: LocalAgentSpec[] = []
    const existing: Task = {
      id: 'task-1',
      kind: 'local_agent',
      description: 'core:reviewer: original',
      state: 'completed',
      outputFile: '/tmp/task-1.log',
      agentId: 'agent-123',
      spec: {
        kind: 'local_agent',
        agentId: 'agent-123',
        agentName: 'core:reviewer',
        task: 'original',
        context: 'old context',
        description: 'core:reviewer: original',
        agentRunner: async function* () { yield { text: 'old' } },
      },
    }
    const manager = {
      get: (id: string) => id === existing.id ? existing : undefined,
      list: () => [existing],
      enqueue: (spec: LocalAgentSpec): Task => {
        specs.push(spec)
        return {
          id: 'task-2',
          kind: 'local_agent',
          description: spec.description,
          state: 'running',
          outputFile: '/tmp/task-2.log',
          agentId: spec.agentId ?? 'agent-task-2',
          spec,
        }
      },
    }
    const agents = new AgentRegistry()
    agents.register(mkAgent('core', 'reviewer'))
    const tool = makeSendAgentTool({
      taskManager: manager,
      agents,
      registry: new ToolRegistry(),
      providerResolver: mkResolver(mkProvider([])),
      permission: new PermissionChecker(() => new PermissionCache(), async () => ({ allowed: true })),
    })

    const result = await tool.run({
      agent_id: 'agent-123',
      message: 'please continue',
      context: 'new facts',
    }, ctx())

    expect(result.isError).toBe(false)
    expect(specs[0]).toMatchObject({
      agentId: 'agent-123',
      agentName: 'core:reviewer',
      task: 'please continue',
      context: ['old context', 'new facts'].join('\n\n'),
      resumed: true,
    })
    expect(result.output as string).toContain('status=sent')
    expect(result.output as string).toContain('task_id=task-2')
    expect(result.output as string).toContain('agent_id=agent-123')
    expect(result.output as string).toContain('sent_to=task-1')
  })

  it('send_input accepts input and reports sent_to for compatibility with Nuka-Code send_input naming', async () => {
    const specs: LocalAgentSpec[] = []
    const existing: Task = {
      id: 'task-1',
      kind: 'local_agent',
      description: 'core:reviewer: original',
      state: 'completed',
      outputFile: '/tmp/task-1.log',
      agentId: 'agent-123',
      spec: {
        kind: 'local_agent',
        agentId: 'agent-123',
        agentName: 'core:reviewer',
        task: 'original',
        context: 'old context',
        description: 'core:reviewer: original',
        agentRunner: async function* () { yield { text: 'old' } },
      },
    }
    const manager = {
      get: (id: string) => id === existing.id ? existing : undefined,
      list: () => [existing],
      enqueue: (spec: LocalAgentSpec): Task => {
        specs.push(spec)
        return {
          id: 'task-2',
          kind: 'local_agent',
          description: spec.description,
          state: 'running',
          outputFile: '/tmp/task-2.log',
          agentId: spec.agentId ?? 'agent-task-2',
          spec,
        }
      },
    }
    const agents = new AgentRegistry()
    agents.register(mkAgent('core', 'reviewer'))
    const tool = makeSendInputTool({
      taskManager: manager,
      agents,
      registry: new ToolRegistry(),
      providerResolver: mkResolver(mkProvider([])),
      permission: new PermissionChecker(() => new PermissionCache(), async () => ({ allowed: true })),
    })

    expect(tool.name).toBe('send_input')
    const result = await tool.run({
      agent_id: 'agent-123',
      input: 'please continue',
      context: 'new facts',
    }, ctx())

    expect(result.isError).toBe(false)
    expect(specs[0]).toMatchObject({
      agentId: 'agent-123',
      agentName: 'core:reviewer',
      task: 'please continue',
      context: ['old context', 'new facts'].join('\n\n'),
      resumed: true,
    })
    expect(result.output as string).toContain('status=sent')
    expect(result.output as string).toContain('sent_to=task-1')
  })

  it('resume_agent rebuilt runner dispatches the new prompt, not the previous closure', async () => {
    const specs: LocalAgentSpec[] = []
    const seenPrompts: string[] = []
    const existing: Task = {
      id: 'task-1',
      kind: 'local_agent',
      description: 'core:reviewer: original',
      state: 'completed',
      outputFile: '/tmp/task-1.log',
      agentId: 'agent-123',
      spec: {
        kind: 'local_agent',
        agentId: 'agent-123',
        agentName: 'core:reviewer',
        task: 'original',
        context: 'old context',
        description: 'core:reviewer: original',
        agentRunner: async function* () { yield { text: 'old-closure-output' } },
      },
    }
    const manager = {
      get: (id: string) => id === existing.id ? existing : undefined,
      list: () => [existing],
      enqueue: (spec: LocalAgentSpec): Task => {
        specs.push(spec)
        return {
          id: 'task-2',
          kind: 'local_agent',
          description: spec.description,
          state: 'running',
          outputFile: '/tmp/task-2.log',
          agentId: spec.agentId ?? 'agent-task-2',
          spec,
        }
      },
    }
    const agents = new AgentRegistry()
    agents.register(mkAgent('core', 'reviewer'))
    const tool = makeResumeAgentTool({
      taskManager: manager,
      agents,
      registry: new ToolRegistry(),
      providerResolver: mkResolver(mkProvider(seenPrompts)),
      permission: new PermissionChecker(() => new PermissionCache(), async () => ({ allowed: true })),
    })

    await tool.run({
      agent_id: 'agent-123',
      prompt: 'continue from here',
      context: 'new facts',
    }, ctx())

    const chunks: string[] = []
    for await (const chunk of specs[0]!.agentRunner(new AbortController().signal)) {
      chunks.push(chunk.text)
    }

    expect(chunks.join('')).toContain('resumed-response')
    expect(chunks.join('')).not.toContain('old-closure-output')
    expect(seenPrompts[0]).toContain('continue from here')
    expect(seenPrompts[0]).toContain('old context')
    expect(seenPrompts[0]).toContain('new facts')
  })

  it('resume_agent rebuilt runner preserves agent skills and effort filtering', async () => {
    const specs: LocalAgentSpec[] = []
    let seenSystem = ''
    let seenEffort: unknown
    const seenResolveEffort: Array<[unknown, string, string]> = []
    const existing: Task = {
      id: 'task-1',
      kind: 'local_agent',
      description: 'core:reviewer: original',
      state: 'completed',
      outputFile: '/tmp/task-1.log',
      agentId: 'agent-123',
      spec: {
        kind: 'local_agent',
        agentId: 'agent-123',
        agentName: 'core:reviewer',
        task: 'original',
        providerId: 'p',
        model: 'm',
        description: 'core:reviewer: original',
        agentRunner: async function* () { yield { text: 'old' } },
      },
    }
    const manager = {
      get: (id: string) => id === existing.id ? existing : undefined,
      list: () => [existing],
      enqueue: (spec: LocalAgentSpec): Task => {
        specs.push(spec)
        return {
          id: 'task-2',
          kind: 'local_agent',
          description: spec.description,
          state: 'running',
          outputFile: '/tmp/task-2.log',
          agentId: spec.agentId ?? 'agent-task-2',
          spec,
        }
      },
    }
    const agents = new AgentRegistry()
    agents.register(mkAgent('core', 'reviewer', {
      skills: ['test-first'],
      effort: 'high',
    }))
    const provider: LLMProvider = {
      id: 'p',
      format: 'openai',
      async *stream(req) {
        seenSystem = req.system
        seenEffort = req.effort
        yield { type: 'text_delta', text: 'resumed-response' }
        yield { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } }
      },
      async listRemoteModels() { return [] },
    } as LLMProvider
    const tool = makeResumeAgentTool({
      taskManager: manager,
      agents,
      registry: new ToolRegistry(),
      providerResolver: mkResolver(provider),
      permission: new PermissionChecker(() => new PermissionCache(), async () => ({ allowed: true })),
      skills: [mkSkill()],
      resolveEffort: (effort, providerId, model) => {
        seenResolveEffort.push([effort, providerId, model])
        return 'medium'
      },
    })

    await tool.run({
      agent_id: 'agent-123',
      prompt: 'continue from here',
    }, ctx())

    for await (const _chunk of specs[0]!.agentRunner(new AbortController().signal)) {
      // drain
    }
    expect(seenSystem).toContain('[Skill: test-first]')
    expect(seenSystem).toContain('Always write the regression test first.')
    expect(seenResolveEffort).toEqual([['high', 'p', 'm']])
    expect(seenEffort).toBe('medium')
  })

  it('resume_agent can rebuild from persisted task metadata when task is not in memory', async () => {
    const specs: LocalAgentSpec[] = []
    const seenPrompts: string[] = []
    writeMeta(home, {
      id: 'old-task',
      kind: 'local_agent',
      state: 'completed',
      startedAt: 10,
      finishedAt: 20,
      agentId: 'agent-persisted',
      agentName: 'core:reviewer',
      agentTask: 'old prompt',
      agentContext: 'persisted context',
      providerId: 'p',
      model: 'm',
      cwd: '/tmp/persisted-worktree',
      writeScope: {
        allow: ['src/core/agents', 'test/core/agents'],
        deny: ['docs/plans'],
        note: 'Keep follow-up edits inside subagent lifecycle files.',
      },
    })
    writeTranscript(home, {
      id: 'old-task',
      agentId: 'agent-persisted',
      agentName: 'core:reviewer',
      providerId: 'p',
      model: 'm',
      writeScope: {
        allow: ['src/core/agents', 'test/core/agents'],
        deny: ['docs/plans'],
        note: 'Keep follow-up edits inside subagent lifecycle files.',
      },
      messages: [
        { role: 'user', content: 'old prompt\n\npersisted context' },
        { role: 'assistant', content: 'previous final output' },
      ],
    })
    const manager = {
      get: () => undefined,
      list: () => [],
      enqueue: (spec: LocalAgentSpec): Task => {
        specs.push(spec)
        return {
          id: 'new-task',
          kind: 'local_agent',
          description: spec.description,
          state: 'running',
          outputFile: '/tmp/new-task.log',
          agentId: spec.agentId ?? 'agent-new-task',
          spec,
        }
      },
    }
    const agents = new AgentRegistry()
    agents.register(mkAgent('core', 'reviewer'))
    const tool = makeResumeAgentTool({
      taskManager: manager,
      home,
      agents,
      registry: new ToolRegistry(),
      providerResolver: mkResolver(mkProvider(seenPrompts)),
      permission: new PermissionChecker(() => new PermissionCache(), async () => ({ allowed: true })),
    })

    const result = await tool.run({
      agent_id: 'agent-persisted',
      prompt: 'continue from disk',
      context: 'new disk facts',
    }, ctx())

    expect(result.isError).toBe(false)
    expect(result.output as string).toContain('resumed_from=old-task')
    expect(specs[0]).toMatchObject({
      agentId: 'agent-persisted',
      agentName: 'core:reviewer',
      task: 'continue from disk',
      providerId: 'p',
      model: 'm',
      cwd: '/tmp/persisted-worktree',
      writeScope: {
        allow: ['src/core/agents', 'test/core/agents'],
        deny: ['docs/plans'],
        note: 'Keep follow-up edits inside subagent lifecycle files.',
      },
      resumed: true,
    })
    expect(specs[0]!.context).toContain('persisted context')
    expect(specs[0]!.context).toContain('previous final output')
    expect(specs[0]!.context).toContain('Write scope:')
    expect(specs[0]!.context).toContain('- Allowed paths: src/core/agents, test/core/agents')
    expect(specs[0]!.context).toContain('- Denied paths: docs/plans')
    expect(specs[0]!.context).toContain('- Note: Keep follow-up edits inside subagent lifecycle files.')
    expect(specs[0]!.context).toContain('new disk facts')

    for await (const _chunk of specs[0]!.agentRunner(new AbortController().signal)) {
      // drain
    }
    expect(seenPrompts[0]).toContain('continue from disk')
    expect(seenPrompts[0]).toContain('persisted context')
    expect(seenPrompts[0]).toContain('previous final output')
    expect(seenPrompts[0]).toContain('Write scope:')
    expect(seenPrompts[0]).toContain('Allowed paths: src/core/agents, test/core/agents')
    expect(seenPrompts[0]).toContain('new disk facts')
  })

  it('resume_agent uses persisted cwd for the rebuilt runner tool context', async () => {
    const specs: LocalAgentSpec[] = []
    const cwdSeen: string[] = []
    writeMeta(home, {
      id: 'old-task',
      kind: 'local_agent',
      state: 'completed',
      startedAt: 10,
      finishedAt: 20,
      agentId: 'agent-persisted',
      agentName: 'core:reviewer',
      agentTask: 'old prompt',
      providerId: 'p',
      model: 'm',
      cwd: '/tmp/persisted-worktree',
    })
    const manager = {
      get: () => undefined,
      list: () => [],
      enqueue: (spec: LocalAgentSpec): Task => {
        specs.push(spec)
        return {
          id: 'new-task',
          kind: 'local_agent',
          description: spec.description,
          state: 'running',
          outputFile: '/tmp/new-task.log',
          agentId: spec.agentId ?? 'agent-new-task',
          spec,
        }
      },
    }
    const agents = new AgentRegistry()
    agents.register(mkAgent('core', 'reviewer'))
    const registry = new ToolRegistry()
    registry.register({
      name: 'PeekCwd',
      description: 'peek cwd',
      parameters: { type: 'object', properties: {} },
      source: 'builtin',
      tags: ['core'],
      needsPermission: () => 'none',
      run: async (_input, toolCtx) => {
        cwdSeen.push(toolCtx.cwd)
        return { isError: false, output: 'cwd-ok' }
      },
    })
    const tool = makeResumeAgentTool({
      taskManager: manager,
      home,
      agents,
      registry,
      providerResolver: mkResolver(mkScriptProvider([
        [
          { type: 'tool_use_start', id: 'cwd-1', name: 'PeekCwd' },
          { type: 'tool_use_stop', id: 'cwd-1', input: {} },
          { type: 'message_stop', stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1 } },
        ],
        [
          { type: 'text_delta', text: 'done' },
          { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } },
        ],
      ])),
      permission: new PermissionChecker(() => new PermissionCache(), async () => ({ allowed: true })),
    })

    await tool.run({
      agent_id: 'agent-persisted',
      prompt: 'continue from disk',
    }, ctx())

    for await (const _chunk of specs[0]!.agentRunner(new AbortController().signal)) {
      // drain
    }
    expect(cwdSeen).toEqual(['/tmp/persisted-worktree'])
  })
})
