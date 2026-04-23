import { describe, it, expect } from 'vitest'
import { runAgent } from '../../../src/core/agent/loop'
import { createSession } from '../../../src/core/session/session'
import type { LLMProvider, ProviderEvent } from '../../../src/core/provider/types'
import { ToolRegistry } from '../../../src/core/tools/registry'
import { PermissionChecker } from '../../../src/core/permission/checker'
import { PermissionCache } from '../../../src/core/permission/cache'
import type { Tool } from '../../../src/core/tools/types'

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
})
