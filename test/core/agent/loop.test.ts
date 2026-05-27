import { describe, it, expect, vi } from 'vitest'
import { runAgent } from '../../../src/core/agent/loop'
import { createSession } from '../../../src/core/session/session'
import type { LLMProvider, ProviderEvent } from '../../../src/core/provider/types'
import { ToolRegistry } from '../../../src/core/tools/registry'
import { PermissionChecker } from '../../../src/core/permission/checker'
import { PermissionCache } from '../../../src/core/permission/cache'
import type { Tool } from '../../../src/core/tools/types'
import type { AutoCompactSessionAwareOpts as AutoCompactOpts } from '../../../src/core/agent/autoCompact'
import { MICROCOMPACT_CLEARED_TOOL_RESULT } from '../../../src/core/compact/microCompact'
import { createEventBus } from '../../../src/core/events/bus'

function stubProvider(scripts: ProviderEvent[][]): LLMProvider {
  let i = 0
  return {
    id: 'p', format: 'openai',
    async *stream() {
      const script = scripts[i++] ?? []
      for (const ev of script) yield ev
    },
    async listRemoteModels() { return [] },
  } as LLMProvider
}

describe('runAgent', () => {
  it('ends on a text-only turn', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    const provider = stubProvider([[
      { type: 'text_delta', text: 'hi' },
      {
        type: 'message_stop',
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]])
    const tools = new ToolRegistry()
    const permission = new PermissionChecker(() => session.permissionCache, async () => ({ allowed: true }))

    const events: any[] = []
    for await (const ev of runAgent(
      { text: 'hi' },
      session,
      { provider: { resolveFor: () => ({ provider, model: 'm' }) } as any, tools, permission },
      new AbortController().signal,
    )) events.push(ev)

    expect(events.at(-1)).toEqual({
      type: 'turn_end',
      stopReason: 'end_turn',
      usage: { inputTokens: 1, outputTokens: 1 },
    })
    expect(session.messages).toHaveLength(2) // user + assistant
  })

  it('retries provider streams that fail before any event and emits retry lifecycle event', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    let calls = 0
    const provider: LLMProvider = {
      id: 'p',
      format: 'openai',
      async *stream() {
        calls += 1
        if (calls === 1) throw new Error('socket reset')
        yield { type: 'text_delta', text: 'recovered' }
        yield {
          type: 'message_stop',
          stopReason: 'end_turn',
          usage: { inputTokens: 2, outputTokens: 1 },
        }
      },
      async listRemoteModels() { return [] },
    }
    const tools = new ToolRegistry()
    const permission = new PermissionChecker(() => session.permissionCache, async () => ({ allowed: true }))
    const bus = createEventBus()
    const busEvents: unknown[] = []
    bus.subscribe('agent', (event) => busEvents.push(event))

    const events: unknown[] = []
    for await (const ev of runAgent(
      { text: 'hi' },
      session,
      {
        provider: { resolveFor: () => ({ provider, model: 'm' }) } as any,
        tools,
        permission,
        bus,
        providerRetry: {
          maxAttempts: 2,
          initialDelayMs: 0,
          jitter: false,
        },
      } as any,
      new AbortController().signal,
    )) events.push(ev)

    expect(calls).toBe(2)
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', stopReason: 'end_turn' })
    expect(busEvents).toContainEqual(expect.objectContaining({
      type: 'agent.provider.retry',
      sessionId: session.id,
      providerId: 'p',
      model: 'm',
      attempt: 1,
      delayMs: 0,
    }))
  })

  it('retries provider stream creation failures before any event', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    let calls = 0
    const provider: LLMProvider = {
      id: 'p',
      format: 'openai',
      stream() {
        calls += 1
        if (calls === 1) throw new Error('connect failed')
        return (async function* () {
          yield { type: 'text_delta', text: 'connected' } satisfies ProviderEvent
          yield {
            type: 'message_stop',
            stopReason: 'end_turn',
            usage: { inputTokens: 2, outputTokens: 1 },
          } satisfies ProviderEvent
        })()
      },
      async listRemoteModels() { return [] },
    }
    const tools = new ToolRegistry()
    const permission = new PermissionChecker(() => session.permissionCache, async () => ({ allowed: true }))
    const bus = createEventBus()
    const busEvents: unknown[] = []
    bus.subscribe('agent', (event) => busEvents.push(event))

    const events: unknown[] = []
    for await (const ev of runAgent(
      { text: 'hi' },
      session,
      {
        provider: { resolveFor: () => ({ provider, model: 'm' }) } as any,
        tools,
        permission,
        bus,
        providerRetry: {
          maxAttempts: 2,
          initialDelayMs: 0,
          jitter: false,
        },
      } as any,
      new AbortController().signal,
    )) events.push(ev)

    expect(calls).toBe(2)
    expect(events).toContainEqual({ type: 'text_delta', text: 'connected' })
    expect(busEvents).toContainEqual(expect.objectContaining({
      type: 'agent.provider.retry',
      attempt: 1,
      error: 'connect failed',
    }))
  })

  it('does not retry provider streams after a partial event has arrived', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    let calls = 0
    const provider: LLMProvider = {
      id: 'p',
      format: 'openai',
      async *stream() {
        calls += 1
        yield { type: 'text_delta', text: 'partial' }
        throw new Error('dropped after partial')
      },
      async listRemoteModels() { return [] },
    }
    const tools = new ToolRegistry()
    const permission = new PermissionChecker(() => session.permissionCache, async () => ({ allowed: true }))
    const bus = createEventBus()
    const busEvents: unknown[] = []
    bus.subscribe('agent', (event) => busEvents.push(event))

    const events: unknown[] = []
    let caught: unknown
    try {
      for await (const ev of runAgent(
        { text: 'hi' },
        session,
        {
          provider: { resolveFor: () => ({ provider, model: 'm' }) } as any,
          tools,
          permission,
          bus,
          providerRetry: {
            maxAttempts: 2,
            initialDelayMs: 0,
            jitter: false,
          },
        },
        new AbortController().signal,
      )) events.push(ev)
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toBe('dropped after partial')
    expect(calls).toBe(1)
    expect(events).toEqual([{ type: 'text_delta', text: 'partial' }])
    expect(busEvents.some(event =>
      typeof event === 'object' &&
      event !== null &&
      (event as { type?: unknown }).type === 'agent.provider.retry',
    )).toBe(false)
  })

  it('runs a tool call then continues the loop until text-only turn', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })

    // Turn 1: assistant emits a tool call
    const turn1: ProviderEvent[] = [
      { type: 'tool_use_start', id: 't1', name: 'Echo' },
      { type: 'tool_use_args_delta', id: 't1', delta: '{"text":"ok"}' },
      { type: 'tool_use_stop', id: 't1', input: { text: 'ok' } },
      {
        type: 'message_stop',
        stopReason: 'tool_use',
        usage: { inputTokens: 5, outputTokens: 3 },
      },
    ]
    // Turn 2: assistant replies and stops
    const turn2: ProviderEvent[] = [
      { type: 'text_delta', text: 'done' },
      {
        type: 'message_stop',
        stopReason: 'end_turn',
        usage: { inputTokens: 2, outputTokens: 1 },
      },
    ]
    const provider = stubProvider([turn1, turn2])

    const tools = new ToolRegistry()
    const echo: Tool<{ text: string }> = {
      name: 'Echo',
      description: 'echo',
      parameters: { type: 'object', properties: { text: { type: 'string' } } },
      source: 'builtin',
      needsPermission: () => 'none',
      run: async (i) => ({ output: i.text, isError: false }),
    }
    tools.register(echo)

    const permission = new PermissionChecker(() => session.permissionCache, async () => ({ allowed: true }))

    const events: any[] = []
    for await (const ev of runAgent(
      { text: 'please echo' },
      session,
      { provider: { resolveFor: () => ({ provider, model: 'm' }) } as any, tools, permission },
      new AbortController().signal,
    )) events.push(ev)

    const types = events.map(e => e.type)
    expect(types).toContain('tool_call')
    expect(types).toContain('tool_result')
    expect(events.at(-1).type).toBe('turn_end')
  })

  it('flushes queued messages at turn boundary', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    session.queue.push('btw')
    // Turn 1: tool call forces another turn
    const turn1: ProviderEvent[] = [
      { type: 'tool_use_start', id: 't1', name: 'Echo' },
      { type: 'tool_use_stop', id: 't1', input: { text: 'x' } },
      { type: 'message_stop', stopReason: 'tool_use', usage: { inputTokens: 0, outputTokens: 0 } },
    ]
    // Turn 2: ends plainly
    const turn2: ProviderEvent[] = [
      { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } },
    ]
    const provider = stubProvider([turn1, turn2])
    const tools = new ToolRegistry()
    tools.register({
      name: 'Echo', description: 'e', parameters: {}, source: 'builtin',
      needsPermission: () => 'none',
      run: async () => ({ output: '', isError: false }),
    })
    const permission = new PermissionChecker(() => session.permissionCache, async () => ({ allowed: true }))
    const events: any[] = []
    for await (const ev of runAgent(
      { text: 'hi' },
      session,
      { provider: { resolveFor: () => ({ provider, model: 'm' }) } as any, tools, permission },
      new AbortController().signal,
    )) events.push(ev)
    expect(events.some(e => e.type === 'queued_message_flushed' && e.count === 1)).toBe(true)
  })

  it('injects keyword skill as system message before user message when keyword matches', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    const provider = stubProvider([[
      { type: 'text_delta', text: 'ok' },
      { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } },
    ]])
    const tools = new ToolRegistry()
    const permission = new PermissionChecker(() => session.permissionCache, async () => ({ allowed: true }))
    const skill = {
      name: 'deploy-skill',
      when: { keyword: ['deploy'] } as const,
      body: 'Always run tests before deploying.',
      source: 'global' as const,
      path: '/fake/deploy.md',
    }

    for await (const _ of runAgent(
      { text: 'please deploy the app' },
      session,
      { provider: { resolveFor: () => ({ provider, model: 'm' }) } as any, tools, permission, skills: [skill] },
      new AbortController().signal,
    )) { /* drain */ }

    const systemMsg = session.messages.find((m) => m.role === 'system')
    expect(systemMsg).toBeDefined()
    expect((systemMsg as any).content).toContain('[Skill: deploy-skill]')
    expect((systemMsg as any).content).toContain('Always run tests before deploying.')
    // system message must appear before the user message
    const sysIdx = session.messages.indexOf(systemMsg!)
    const userIdx = session.messages.findIndex((m) => m.role === 'user')
    expect(sysIdx).toBeLessThan(userIdx)
  })

  it('microcompacts stale tool results before provider calls without mutating session history', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    session.messages = [
      {
        role: 'assistant',
        id: 'a1',
        ts: 1,
        content: [{ type: 'tool_use', id: 'call_1', name: 'Read', input: { path: 'old.ts' } }],
      },
      {
        role: 'tool',
        toolUseId: 'call_1',
        content: 'old read result',
        isError: false,
        id: 't1',
        ts: 2,
      },
      {
        role: 'assistant',
        id: 'a2',
        ts: 3,
        content: [{ type: 'tool_use', id: 'call_2', name: 'Read', input: { path: 'new.ts' } }],
      },
      {
        role: 'tool',
        toolUseId: 'call_2',
        content: 'new read result',
        isError: false,
        id: 't2',
        ts: 4,
      },
    ]
    let providerMessages: unknown[] = []
    const provider: LLMProvider = {
      id: 'p',
      format: 'openai',
      async *stream(req) {
        providerMessages = req.messages
        yield {
          type: 'message_stop',
          stopReason: 'end_turn',
          usage: { inputTokens: 1, outputTokens: 1 },
        }
      },
      async listRemoteModels() { return [] },
    } as LLMProvider
    const tools = new ToolRegistry()
    const permission = new PermissionChecker(() => session.permissionCache, async () => ({ allowed: true }))

    for await (const _ of runAgent(
      { text: 'continue' },
      session,
      {
        provider: { resolveFor: () => ({ provider, model: 'm' }) } as any,
        tools,
        permission,
        microCompact: { keepRecent: 1 },
      },
      new AbortController().signal,
    )) { /* drain */ }

    expect((providerMessages[1] as any).content).toBe(MICROCOMPACT_CLEARED_TOOL_RESULT)
    expect((providerMessages[3] as any).content).toBe('new read result')
    expect((session.messages[1] as any).content).toBe('old read result')
  })

  it('yields tool_progress events before tool_result when tool calls onProgress', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    const turn1: ProviderEvent[] = [
      { type: 'tool_use_start', id: 'tp1', name: 'Progress' },
      { type: 'tool_use_stop', id: 'tp1', input: {} },
      { type: 'message_stop', stopReason: 'tool_use', usage: { inputTokens: 0, outputTokens: 0 } },
    ]
    const turn2: ProviderEvent[] = [
      { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } },
    ]
    const provider = stubProvider([turn1, turn2])
    const tools = new ToolRegistry()
    const progressTool: Tool<Record<string, never>> = {
      name: 'Progress',
      description: 'emits progress',
      parameters: { type: 'object', properties: {} },
      source: 'builtin',
      needsPermission: () => 'none',
      run: async (_i, ctx) => {
        ctx.onProgress?.('a')
        ctx.onProgress?.('b')
        return { output: 'done', isError: false }
      },
    }
    tools.register(progressTool)
    const permission = new PermissionChecker(() => session.permissionCache, async () => ({ allowed: true }))
    const events: any[] = []
    for await (const ev of runAgent(
      { text: 'go' },
      session,
      { provider: { resolveFor: () => ({ provider, model: 'm' }) } as any, tools, permission },
      new AbortController().signal,
    )) events.push(ev)

    const progressEvents = events.filter(e => e.type === 'tool_progress')
    expect(progressEvents).toHaveLength(2)
    expect(progressEvents[0]).toMatchObject({ type: 'tool_progress', id: 'tp1', text: 'a' })
    expect(progressEvents[1]).toMatchObject({ type: 'tool_progress', id: 'tp1', text: 'b' })
    const resultIdx = events.findIndex(e => e.type === 'tool_result' && e.id === 'tp1')
    const lastProgressIdx = events.map(e => e.type).lastIndexOf('tool_progress')
    expect(lastProgressIdx).toBeLessThan(resultIdx)
  })

  it('stores a remembered rule exactly once in session.permissionCache (no duplicate push)', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    const turn1: ProviderEvent[] = [
      { type: 'tool_use_start', id: 't1', name: 'Echo' },
      { type: 'tool_use_stop', id: 't1', input: { text: 'x' } },
      { type: 'message_stop', stopReason: 'tool_use', usage: { inputTokens: 0, outputTokens: 0 } },
    ]
    const turn2: ProviderEvent[] = [
      { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } },
    ]
    const provider = stubProvider([turn1, turn2])
    const tools = new ToolRegistry()
    tools.register({
      name: 'Echo', description: 'e', parameters: {}, source: 'builtin',
      needsPermission: () => 'write',
      run: async () => ({ output: '', isError: false }),
    })
    const permission = new PermissionChecker(
      () => session.permissionCache,
      async () => ({ allowed: true, remember: { scope: 'session', hint: 'write' } }),
    )
    for await (const _ of runAgent(
      { text: 'hi' },
      session,
      { provider: { resolveFor: () => ({ provider, model: 'm' }) } as any, tools, permission },
      new AbortController().signal,
    )) { /* drain */ }
    // checker's add() is the only writer — must be exactly 1, not 2
    expect(session.permissionCache.list()).toHaveLength(1)
  })

  it('emits error tool_result and skips run when input validation fails', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    // Turn 1: tool call with invalid input (missing required 'x')
    const turn1: ProviderEvent[] = [
      { type: 'tool_use_start', id: 'v1', name: 'Strict' },
      { type: 'tool_use_stop', id: 'v1', input: {} }, // missing 'x'
      { type: 'message_stop', stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1 } },
    ]
    // Turn 2: ends plainly
    const turn2: ProviderEvent[] = [
      { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } },
    ]
    const provider = stubProvider([turn1, turn2])
    const tools = new ToolRegistry()
    let runCalled = false
    const strictTool: Tool = {
      name: 'Strict',
      description: 'needs x',
      parameters: { type: 'object', required: ['x'], properties: { x: { type: 'string' } } },
      source: 'builtin',
      needsPermission: () => 'none',
      run: async () => { runCalled = true; return { output: 'should not run', isError: false } },
    }
    tools.register(strictTool)
    const permissionCalled: string[] = []
    const permission = new PermissionChecker(
      () => session.permissionCache,
      async (req) => { permissionCalled.push(req.toolName); return { allowed: true } },
    )
    const events: any[] = []
    for await (const ev of runAgent(
      { text: 'run strict' },
      session,
      { provider: { resolveFor: () => ({ provider, model: 'm' }) } as any, tools, permission },
      new AbortController().signal,
    )) events.push(ev)

    const toolResult = events.find(e => e.type === 'tool_result' && e.id === 'v1')
    expect(toolResult).toBeDefined()
    expect(toolResult.isError).toBe(true)
    expect(toolResult.output).toMatch(/invalid input/)
    // tool.run must NOT have been called
    expect(runCalled).toBe(false)
    // permission prompt must NOT have been shown
    expect(permissionCalled).toHaveLength(0)
    // no 'tool_call' event should have been emitted for this tool
    expect(events.some(e => e.type === 'tool_call' && e.id === 'v1')).toBe(false)
  })

  it('accepts valid input and runs tool normally', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    const turn1: ProviderEvent[] = [
      { type: 'tool_use_start', id: 'v2', name: 'Strict' },
      { type: 'tool_use_stop', id: 'v2', input: { x: 'hello' } },
      { type: 'message_stop', stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1 } },
    ]
    const turn2: ProviderEvent[] = [
      { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } },
    ]
    const provider = stubProvider([turn1, turn2])
    const tools = new ToolRegistry()
    let runCalled = false
    tools.register({
      name: 'Strict',
      description: 'needs x',
      parameters: { type: 'object', required: ['x'], properties: { x: { type: 'string' } } },
      source: 'builtin',
      needsPermission: () => 'none',
      run: async () => { runCalled = true; return { output: 'ran', isError: false } },
    })
    const permission = new PermissionChecker(() => session.permissionCache, async () => ({ allowed: true }))
    const events: any[] = []
    for await (const ev of runAgent(
      { text: 'go' },
      session,
      { provider: { resolveFor: () => ({ provider, model: 'm' }) } as any, tools, permission },
      new AbortController().signal,
    )) events.push(ev)

    expect(runCalled).toBe(true)
    const toolResult = events.find(e => e.type === 'tool_result' && e.id === 'v2')
    expect(toolResult?.isError).toBe(false)
  })

  it('truncates output when maxResultSizeChars is set and output exceeds the limit', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    const turn1: ProviderEvent[] = [
      { type: 'tool_use_start', id: 'trunc1', name: 'Big' },
      { type: 'tool_use_stop', id: 'trunc1', input: {} },
      { type: 'message_stop', stopReason: 'tool_use', usage: { inputTokens: 0, outputTokens: 0 } },
    ]
    const turn2: ProviderEvent[] = [
      { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } },
    ]
    const provider = stubProvider([turn1, turn2])
    const tools = new ToolRegistry()
    const bigOutput = 'x'.repeat(500)
    tools.register({
      name: 'Big',
      description: 'returns large output',
      parameters: { type: 'object', properties: {} },
      source: 'builtin',
      maxResultSizeChars: 100,
      needsPermission: () => 'none',
      run: async () => ({ output: bigOutput, isError: false }),
    })
    const permission = new PermissionChecker(() => session.permissionCache, async () => ({ allowed: true }))
    const events: any[] = []
    for await (const ev of runAgent(
      { text: 'big' },
      session,
      { provider: { resolveFor: () => ({ provider, model: 'm' }) } as any, tools, permission },
      new AbortController().signal,
    )) events.push(ev)

    const toolResult = events.find(e => e.type === 'tool_result' && e.id === 'trunc1')
    expect(toolResult).toBeDefined()
    expect(toolResult.output.length).toBeLessThan(500)
    expect(toolResult.output).toContain('[truncated')
    expect(toolResult.output).toContain('400 chars')
  })

  it('yields auto_compacted event when totalUsage exceeds autoThreshold after a turn', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    // Pre-populate enough turns so the structural fold has middle messages
    for (let i = 0; i < 6; i++) {
      session.messages.push({ role: 'user', id: `u${i}`, ts: i, content: [{ type: 'text', text: `u${i}-${'x'.repeat(200)}` }] })
      session.messages.push({ role: 'assistant', id: `a${i}`, ts: i, content: [{ type: 'text', text: `a${i}-${'y'.repeat(200)}` }] })
    }
    // Set totalUsage above the threshold (contextWindow:1000 * autoThreshold:0.8 = 800)
    session.totalUsage = { inputTokens: 500, outputTokens: 400 }

    const mainProvider = stubProvider([[
      { type: 'text_delta', text: 'hello' },
      { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } },
    ]])

    const autoCompact: AutoCompactOpts = {
      autoThreshold: 0.8,
      contextWindow: 1000,
    }

    const tools = new ToolRegistry()
    const permission = new PermissionChecker(() => session.permissionCache, async () => ({ allowed: true }))

    const events: any[] = []
    for await (const ev of runAgent(
      { text: 'hi' },
      session,
      { provider: { resolveFor: () => ({ provider: mainProvider, model: 'm' }) } as any, tools, permission, autoCompact },
      new AbortController().signal,
    )) events.push(ev)

    expect(events.some(e => e.type === 'auto_compacted')).toBe(true)
    const compactedEv = events.find(e => e.type === 'auto_compacted')
    expect(typeof compactedEv.before).toBe('number')
    expect(typeof compactedEv.after).toBe('number')
  })

  // ── Parallel execution tests ──────────────────────────────────────────────

  it('runs two readOnly tools in parallel (wall-time ~max, not sum)', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    const turn1: ProviderEvent[] = [
      { type: 'tool_use_start', id: 'par1', name: 'Fast' },
      { type: 'tool_use_stop', id: 'par1', input: {} },
      { type: 'tool_use_start', id: 'par2', name: 'Slow' },
      { type: 'tool_use_stop', id: 'par2', input: {} },
      { type: 'message_stop', stopReason: 'tool_use', usage: { inputTokens: 0, outputTokens: 0 } },
    ]
    const turn2: ProviderEvent[] = [
      { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } },
    ]
    const provider = stubProvider([turn1, turn2])
    const tools = new ToolRegistry()

    const fastTool: Tool = {
      name: 'Fast',
      description: 'fast read-only tool',
      parameters: { type: 'object', properties: {} },
      source: 'builtin',
      annotations: { readOnly: true },
      needsPermission: () => 'none',
      run: async () => {
        await new Promise<void>(r => setTimeout(r, 30))
        return { output: 'fast', isError: false }
      },
    }
    const slowTool: Tool = {
      name: 'Slow',
      description: 'slow read-only tool',
      parameters: { type: 'object', properties: {} },
      source: 'builtin',
      annotations: { readOnly: true },
      needsPermission: () => 'none',
      run: async () => {
        await new Promise<void>(r => setTimeout(r, 60))
        return { output: 'slow', isError: false }
      },
    }
    tools.register(fastTool)
    tools.register(slowTool)
    const permission = new PermissionChecker(() => session.permissionCache, async () => ({ allowed: true }))

    const t0 = Date.now()
    const events: any[] = []
    for await (const ev of runAgent(
      { text: 'go' },
      session,
      { provider: { resolveFor: () => ({ provider, model: 'm' }) } as any, tools, permission },
      new AbortController().signal,
    )) events.push(ev)
    const elapsed = Date.now() - t0

    // Parallel: should take ~60ms not ~90ms
    expect(elapsed).toBeLessThan(90)
    // Both tool_result events present
    const results = events.filter(e => e.type === 'tool_result')
    expect(results).toHaveLength(2)
  })

  it('emits events in INPUT ORDER even when second tool completes first', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    const turn1: ProviderEvent[] = [
      { type: 'tool_use_start', id: 'first', name: 'SlowRead' },
      { type: 'tool_use_stop', id: 'first', input: {} },
      { type: 'tool_use_start', id: 'second', name: 'FastRead' },
      { type: 'tool_use_stop', id: 'second', input: {} },
      { type: 'message_stop', stopReason: 'tool_use', usage: { inputTokens: 0, outputTokens: 0 } },
    ]
    const turn2: ProviderEvent[] = [
      { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } },
    ]
    const provider = stubProvider([turn1, turn2])
    const tools = new ToolRegistry()

    tools.register({
      name: 'SlowRead',
      description: 'slow',
      parameters: { type: 'object', properties: {} },
      source: 'builtin',
      annotations: { readOnly: true },
      needsPermission: () => 'none',
      run: async () => {
        await new Promise<void>(r => setTimeout(r, 60))
        return { output: 'slow', isError: false }
      },
    })
    tools.register({
      name: 'FastRead',
      description: 'fast',
      parameters: { type: 'object', properties: {} },
      source: 'builtin',
      annotations: { readOnly: true },
      needsPermission: () => 'none',
      run: async () => {
        await new Promise<void>(r => setTimeout(r, 10))
        return { output: 'fast', isError: false }
      },
    })
    const permission = new PermissionChecker(() => session.permissionCache, async () => ({ allowed: true }))

    const events: any[] = []
    for await (const ev of runAgent(
      { text: 'go' },
      session,
      { provider: { resolveFor: () => ({ provider, model: 'm' }) } as any, tools, permission },
      new AbortController().signal,
    )) events.push(ev)

    const toolEvents = events.filter(e => e.type === 'tool_call' || e.type === 'tool_result')
    // Should be: tool_call[first], tool_result[first], tool_call[second], tool_result[second]
    expect(toolEvents[0]).toMatchObject({ type: 'tool_call', id: 'first' })
    expect(toolEvents[1]).toMatchObject({ type: 'tool_result', id: 'first' })
    expect(toolEvents[2]).toMatchObject({ type: 'tool_call', id: 'second' })
    expect(toolEvents[3]).toMatchObject({ type: 'tool_result', id: 'second' })
  })

  it('falls back to serial when batch contains a non-readOnly tool', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    const turn1: ProviderEvent[] = [
      { type: 'tool_use_start', id: 'r1', name: 'ReadTool' },
      { type: 'tool_use_stop', id: 'r1', input: {} },
      { type: 'tool_use_start', id: 'w1', name: 'WriteTool' },
      { type: 'tool_use_stop', id: 'w1', input: {} },
      { type: 'message_stop', stopReason: 'tool_use', usage: { inputTokens: 0, outputTokens: 0 } },
    ]
    const turn2: ProviderEvent[] = [
      { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } },
    ]
    const provider = stubProvider([turn1, turn2])
    const tools = new ToolRegistry()
    const runOrder: string[] = []

    tools.register({
      name: 'ReadTool',
      description: 'read',
      parameters: { type: 'object', properties: {} },
      source: 'builtin',
      annotations: { readOnly: true },
      needsPermission: () => 'none',
      run: async () => { runOrder.push('ReadTool'); return { output: 'r', isError: false } },
    })
    tools.register({
      name: 'WriteTool',
      description: 'write',
      parameters: { type: 'object', properties: {} },
      source: 'builtin',
      // NO readOnly annotation
      needsPermission: () => 'write',
      run: async () => { runOrder.push('WriteTool'); return { output: 'w', isError: false } },
    })
    const permission = new PermissionChecker(() => session.permissionCache, async () => ({ allowed: true }))

    const events: any[] = []
    for await (const ev of runAgent(
      { text: 'go' },
      session,
      { provider: { resolveFor: () => ({ provider, model: 'm' }) } as any, tools, permission },
      new AbortController().signal,
    )) events.push(ev)

    // Serial order preserved: ReadTool first, WriteTool second
    expect(runOrder).toEqual(['ReadTool', 'WriteTool'])
  })

  it('falls back to serial when batch has duplicate tool names', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    const turn1: ProviderEvent[] = [
      { type: 'tool_use_start', id: 'dup1', name: 'ReadTool' },
      { type: 'tool_use_stop', id: 'dup1', input: {} },
      { type: 'tool_use_start', id: 'dup2', name: 'ReadTool' },
      { type: 'tool_use_stop', id: 'dup2', input: {} },
      { type: 'message_stop', stopReason: 'tool_use', usage: { inputTokens: 0, outputTokens: 0 } },
    ]
    const turn2: ProviderEvent[] = [
      { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } },
    ]
    const provider = stubProvider([turn1, turn2])
    const tools = new ToolRegistry()
    let runCount = 0

    tools.register({
      name: 'ReadTool',
      description: 'read',
      parameters: { type: 'object', properties: {} },
      source: 'builtin',
      annotations: { readOnly: true },
      needsPermission: () => 'none',
      run: async () => { runCount++; return { output: `run${runCount}`, isError: false } },
    })
    const permission = new PermissionChecker(() => session.permissionCache, async () => ({ allowed: true }))

    const events: any[] = []
    for await (const ev of runAgent(
      { text: 'go' },
      session,
      { provider: { resolveFor: () => ({ provider, model: 'm' }) } as any, tools, permission },
      new AbortController().signal,
    )) events.push(ev)

    // Both calls ran (serial fallback)
    expect(runCount).toBe(2)
    const results = events.filter(e => e.type === 'tool_result')
    expect(results).toHaveLength(2)
  })

  it('two parallel dispatch_agent calls run concurrently (M5.1.6)', async () => {
    const { makeDispatchAgentTool } = await import('../../../src/core/agents/dispatchTool')
    const { AgentRegistry } = await import('../../../src/core/agents/registry')

    const agents = new AgentRegistry()
    agents.register({
      name: 'slow', description: 'slow', systemPrompt: 's', maxTurns: 20, pluginName: 'core',
    })
    agents.register({
      name: 'fast', description: 'fast', systemPrompt: 's', maxTurns: 20, pluginName: 'core',
    })

    // Sub-agent provider returns a short text after a per-agent delay so we
    // can detect parallelism. Each dispatch call spawns its own stream() —
    // the same provider object is shared.
    let streamCalls = 0
    const subProvider: LLMProvider = {
      id: 'p', format: 'openai',
      async *stream(req) {
        streamCalls++
        // Delay keyed off the system prompt content is unreliable; instead
        // use the first user message text.
        const m = req.messages[0] as { content: Array<{ text: string }> }
        const text = m.content[0]!.text
        const delay = text.includes('slow') ? 120 : 30
        await new Promise<void>(r => setTimeout(r, delay))
        yield { type: 'text_delta', text: `done-${text}` }
        yield { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } }
      },
      async listRemoteModels() { return [] },
    } as LLMProvider

    const subResolver = { resolveFor: () => ({ provider: subProvider, model: 'm' }), listProviders: () => [{ id: 'p' } as unknown as never] } as unknown as import('../../../src/core/provider/resolver').ProviderResolver

    const permission = new PermissionChecker(() => new PermissionCache(), async () => ({ allowed: true }))
    const tools = new ToolRegistry()
    const dispatchTool = makeDispatchAgentTool({
      agents,
      registry: tools,
      providerResolver: subResolver,
      permission,
    })
    tools.register(dispatchTool as any)

    // Main-session provider: one turn with two dispatch_agent tool calls,
    // then a final text turn.
    const turn1: ProviderEvent[] = [
      { type: 'tool_use_start', id: 'd1', name: 'dispatch_agent' },
      { type: 'tool_use_stop', id: 'd1', input: { agent: 'core:slow', task: 'slow' } },
      { type: 'tool_use_start', id: 'd2', name: 'dispatch_agent' },
      { type: 'tool_use_stop', id: 'd2', input: { agent: 'core:fast', task: 'fast' } },
      { type: 'message_stop', stopReason: 'tool_use', usage: { inputTokens: 0, outputTokens: 0 } },
    ]
    const turn2: ProviderEvent[] = [
      { type: 'text_delta', text: 'ok' },
      { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } },
    ]
    const mainProvider = stubProvider([turn1, turn2])

    const session = createSession({ providerId: 'p', model: 'm' })
    const t0 = Date.now()
    const events: any[] = []
    for await (const ev of runAgent(
      { text: 'route' },
      session,
      { provider: { resolveFor: () => ({ provider: mainProvider, model: 'm' }) } as any, tools, permission },
      new AbortController().signal,
    )) events.push(ev)
    const elapsed = Date.now() - t0

    // Parallel: ~120ms (max) not ~150ms (sum). Margin accounts for scheduler jitter.
    expect(elapsed).toBeLessThan(140)
    expect(streamCalls).toBe(2)
    const results = events.filter(e => e.type === 'tool_result')
    expect(results).toHaveLength(2)
    // Each sub-agent produced its own distinct output.
    expect(results[0]!.output).toContain('done-slow')
    expect(results[1]!.output).toContain('done-fast')
  })

  it('records assistant-turn usage into the cost tracker (Phase 7 §5.2)', async () => {
    const { CostTracker } = await import('../../../src/core/cost/tracker')
    const session = createSession({ providerId: 'p', model: 'claude-haiku-4-5' })
    const provider = stubProvider([[
      { type: 'text_delta', text: 'ok' },
      {
        type: 'message_stop',
        stopReason: 'end_turn',
        usage: { inputTokens: 7, outputTokens: 3, cacheReadTokens: 2, cacheWriteTokens: 1 },
      },
    ]])
    const tools = new ToolRegistry()
    const permission = new PermissionChecker(() => session.permissionCache, async () => ({ allowed: true }))
    const tracker = new CostTracker()

    for await (const _ of runAgent(
      { text: 'hi' },
      session,
      { provider: { resolveFor: () => ({ provider, model: 'claude-haiku-4-5' }) } as any, tools, permission, costTracker: tracker },
      new AbortController().signal,
    )) void _

    const cur = tracker.current(session.id)
    expect(cur.turns).toBe(1)
    expect(cur.inputTokens).toBe(7)
    expect(cur.outputTokens).toBe(3)
    expect(cur.cacheReadTokens).toBe(2)
    expect(cur.cacheCreateTokens).toBe(1)
    const usd = tracker.toUsd('claude-haiku-4-5', cur)
    expect(usd).toBeDefined()
    expect(usd!).toBeGreaterThan(0)
  })

  // ── Phase 8 §4.4 — plan-mode blast-radius guard ─────────────────────
  it('plan-mode denies a Write tool call and surfaces isError=true tool_result', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    session.mode = 'plan'

    const turn1: ProviderEvent[] = [
      { type: 'tool_use_start', id: 'w1', name: 'Write' },
      { type: 'tool_use_stop', id: 'w1', input: { path: '/tmp/x', content: 'hi' } },
      { type: 'message_stop', stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1 } },
    ]
    const turn2: ProviderEvent[] = [
      { type: 'text_delta', text: 'ack' },
      { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } },
    ]
    const provider = stubProvider([turn1, turn2])

    const tools = new ToolRegistry()
    const writeTool: Tool<{ path: string; content: string }> = {
      name: 'Write',
      description: 'write',
      parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } },
      source: 'builtin',
      needsPermission: () => 'write',
      run: async () => {
        throw new Error('tool should not have executed in plan mode')
      },
    }
    tools.register(writeTool)

    // The UI callback is the plan-gate's fallback; verify it's NEVER called.
    const ask = vi.fn()
    const permission = new PermissionChecker(() => session.permissionCache, ask)

    const events: any[] = []
    for await (const ev of runAgent(
      { text: 'please write' },
      session,
      { provider: { resolveFor: () => ({ provider, model: 'm' }) } as any, tools, permission },
      new AbortController().signal,
    )) events.push(ev)

    const toolResult = events.find(e => e.type === 'tool_result' && e.id === 'w1')
    expect(toolResult).toBeDefined()
    expect(toolResult.isError).toBe(true)
    expect(toolResult.output).toMatch(/plan mode is active/)
    expect(ask).not.toHaveBeenCalled()
  })

  it('skips cost tracking when no tracker is provided (back-compat)', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    const provider = stubProvider([[
      { type: 'text_delta', text: 'ok' },
      { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } },
    ]])
    const tools = new ToolRegistry()
    const permission = new PermissionChecker(() => session.permissionCache, async () => ({ allowed: true }))
    // No throw, no tracker present.
    for await (const _ of runAgent(
      { text: 'hi' },
      session,
      { provider: { resolveFor: () => ({ provider, model: 'm' }) } as any, tools, permission },
      new AbortController().signal,
    )) void _
    expect(session.totalUsage.inputTokens).toBe(1)
  })
})
