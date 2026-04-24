// test/core/tools/progress.test.ts
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

function makePermission(): PermissionChecker {
  return new PermissionChecker(() => new PermissionCache(), async () => ({ allowed: true }))
}

describe('typed progress (M2.12)', () => {
  it('existing string-progress tools (no progressType) are unchanged', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    const turn1: ProviderEvent[] = [
      { type: 'tool_use_start', id: 'sp1', name: 'StringProg' },
      { type: 'tool_use_stop', id: 'sp1', input: {} },
      { type: 'message_stop', stopReason: 'tool_use', usage: { inputTokens: 0, outputTokens: 0 } },
    ]
    const turn2: ProviderEvent[] = [
      { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } },
    ]
    const provider = stubProvider([turn1, turn2])
    const tools = new ToolRegistry()

    const stringProgTool: Tool<Record<string, never>> = {
      name: 'StringProg',
      description: 'emits string progress',
      parameters: { type: 'object', properties: {} },
      source: 'builtin',
      // NO progressType set (default behavior)
      needsPermission: () => 'none',
      run: async (_input, ctx) => {
        ctx.onProgress?.('hello')
        ctx.onProgress?.('world')
        return { output: 'done', isError: false }
      },
    }
    tools.register(stringProgTool)

    const events: any[] = []
    for await (const ev of runAgent(
      { text: 'go' },
      session,
      { provider: { resolveFor: () => ({ provider, model: 'm' }) } as any, tools, permission: makePermission() },
      new AbortController().signal,
    )) events.push(ev)

    const progressEvents = events.filter(e => e.type === 'tool_progress')
    expect(progressEvents).toHaveLength(2)
    expect(progressEvents[0]).toMatchObject({ type: 'tool_progress', id: 'sp1', text: 'hello' })
    expect(progressEvents[1]).toMatchObject({ type: 'tool_progress', id: 'sp1', text: 'world' })
  })

  it('progressType=object tool with onProgressTyped emits JSON-serialized payload', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    const turn1: ProviderEvent[] = [
      { type: 'tool_use_start', id: 'tp1', name: 'ObjectProg' },
      { type: 'tool_use_stop', id: 'tp1', input: {} },
      { type: 'message_stop', stopReason: 'tool_use', usage: { inputTokens: 0, outputTokens: 0 } },
    ]
    const turn2: ProviderEvent[] = [
      { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } },
    ]
    const provider = stubProvider([turn1, turn2])
    const tools = new ToolRegistry()

    const objectProgTool: Tool<Record<string, never>> = {
      name: 'ObjectProg',
      description: 'emits typed progress',
      parameters: { type: 'object', properties: {} },
      source: 'builtin',
      progressType: 'object',
      needsPermission: () => 'none',
      run: async (_input, ctx) => {
        ctx.onProgressTyped?.({ pct: 50, message: 'halfway' })
        ctx.onProgressTyped?.({ pct: 100, message: 'done' })
        return { output: 'completed', isError: false }
      },
    }
    tools.register(objectProgTool)

    const events: any[] = []
    for await (const ev of runAgent(
      { text: 'go' },
      session,
      { provider: { resolveFor: () => ({ provider, model: 'm' }) } as any, tools, permission: makePermission() },
      new AbortController().signal,
    )) events.push(ev)

    const progressEvents = events.filter(e => e.type === 'tool_progress')
    expect(progressEvents).toHaveLength(2)
    expect(progressEvents[0]).toMatchObject({ type: 'tool_progress', id: 'tp1', text: '{"pct":50,"message":"halfway"}' })
    expect(progressEvents[1]).toMatchObject({ type: 'tool_progress', id: 'tp1', text: '{"pct":100,"message":"done"}' })
  })

  it('onProgressTyped is undefined when progressType is not object', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    const turn1: ProviderEvent[] = [
      { type: 'tool_use_start', id: 'np1', name: 'NoTyped' },
      { type: 'tool_use_stop', id: 'np1', input: {} },
      { type: 'message_stop', stopReason: 'tool_use', usage: { inputTokens: 0, outputTokens: 0 } },
    ]
    const turn2: ProviderEvent[] = [
      { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } },
    ]
    const provider = stubProvider([turn1, turn2])
    const tools = new ToolRegistry()

    let receivedOnProgressTyped: unknown = 'not-set'
    const noTypedTool: Tool<Record<string, never>> = {
      name: 'NoTyped',
      description: 'checks onProgressTyped availability',
      parameters: { type: 'object', properties: {} },
      source: 'builtin',
      progressType: 'line', // explicitly line
      needsPermission: () => 'none',
      run: async (_input, ctx) => {
        receivedOnProgressTyped = ctx.onProgressTyped
        return { output: 'done', isError: false }
      },
    }
    tools.register(noTypedTool)

    for await (const _ of runAgent(
      { text: 'go' },
      session,
      { provider: { resolveFor: () => ({ provider, model: 'm' }) } as any, tools, permission: makePermission() },
      new AbortController().signal,
    )) { /* drain */ }

    expect(receivedOnProgressTyped).toBeUndefined()
  })

  it('progressType=object tool emitting single payload via pct:50 matches spec', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    const turn1: ProviderEvent[] = [
      { type: 'tool_use_start', id: 'spec1', name: 'Pct' },
      { type: 'tool_use_stop', id: 'spec1', input: {} },
      { type: 'message_stop', stopReason: 'tool_use', usage: { inputTokens: 0, outputTokens: 0 } },
    ]
    const turn2: ProviderEvent[] = [
      { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } },
    ]
    const provider = stubProvider([turn1, turn2])
    const tools = new ToolRegistry()

    tools.register({
      name: 'Pct',
      description: 'pct tool',
      parameters: { type: 'object', properties: {} },
      source: 'builtin',
      progressType: 'object',
      needsPermission: () => 'none',
      run: async (_input, ctx) => {
        ctx.onProgressTyped?.({ pct: 50 })
        return { output: 'done', isError: false }
      },
    })

    const events: any[] = []
    for await (const ev of runAgent(
      { text: 'go' },
      session,
      { provider: { resolveFor: () => ({ provider, model: 'm' }) } as any, tools, permission: makePermission() },
      new AbortController().signal,
    )) events.push(ev)

    const progressEvent = events.find(e => e.type === 'tool_progress' && e.id === 'spec1')
    expect(progressEvent).toBeDefined()
    expect(progressEvent.text).toBe('{"pct":50}')
  })
})
