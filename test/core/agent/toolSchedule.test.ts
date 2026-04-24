// test/core/agent/toolSchedule.test.ts
import { describe, it, expect } from 'vitest'
import { runAgent } from '../../../src/core/agent/loop'
import { createSession } from '../../../src/core/session/session'
import type { LLMProvider, ProviderEvent, ToolSpec } from '../../../src/core/provider/types'
import { ToolRegistry } from '../../../src/core/tools/registry'
import { PermissionChecker } from '../../../src/core/permission/checker'
import { PermissionCache } from '../../../src/core/permission/cache'
import type { Tool } from '../../../src/core/tools/types'

// A provider that captures the tool specs it was called with
function capturingProvider(capturedSpecs: ToolSpec[][]): LLMProvider {
  return {
    id: 'p', format: 'openai',
    async *stream({ tools }: { tools: ToolSpec[] }): AsyncIterable<ProviderEvent> {
      capturedSpecs.push(tools)
      yield { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } }
    },
    async listRemoteModels() { return [] },
  } as LLMProvider
}

function makePermission(cache = new PermissionCache()): PermissionChecker {
  return new PermissionChecker(() => cache, async () => ({ allowed: true }))
}

const baseTool = (name: string, overrides: Partial<Tool> = {}): Tool => ({
  name,
  description: `tool ${name}`,
  parameters: { type: 'object', properties: {} },
  source: 'builtin',
  needsPermission: () => 'none',
  run: async () => ({ output: name, isError: false }),
  ...overrides,
})

describe('tool scheduling (M2.9)', () => {
  it('alwaysLoad=true tool is included in every provider call', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    const captured: ToolSpec[][] = []
    const provider = capturingProvider(captured)
    const tools = new ToolRegistry()

    tools.register(baseTool('Normal'))
    tools.register(baseTool('AlwaysHere', { alwaysLoad: true }))
    tools.register(baseTool('Deferred', {
      shouldDefer: () => true,
      searchHint: ['trigger'],
    }))

    for await (const _ of runAgent(
      { text: 'hello' },
      session,
      { provider: { resolveFor: () => ({ provider, model: 'm' }) } as any, tools, permission: makePermission() },
      new AbortController().signal,
    )) { /* drain */ }

    expect(captured).toHaveLength(1)
    const names = captured[0]!.map(s => s.name)
    expect(names).toContain('AlwaysHere')
    expect(names).toContain('Normal')
    // Deferred tool should not appear (no matching hint)
    expect(names).not.toContain('Deferred')
  })

  it('shouldDefer tool absent until searchHint matches user text', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    const captured: ToolSpec[][] = []
    const provider = capturingProvider(captured)
    const tools = new ToolRegistry()

    tools.register(baseTool('LazyTool', {
      shouldDefer: () => true,
      searchHint: ['activate', 'lazyload'],
    }))

    for await (const _ of runAgent(
      { text: 'please lazyload now' },
      session,
      { provider: { resolveFor: () => ({ provider, model: 'm' }) } as any, tools, permission: makePermission() },
      new AbortController().signal,
    )) { /* drain */ }

    expect(captured).toHaveLength(1)
    const names = captured[0]!.map(s => s.name)
    // lazyload keyword matched → tool should be included
    expect(names).toContain('LazyTool')
  })

  it('shouldDefer tool stays absent when user text does not match searchHint', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    const captured: ToolSpec[][] = []
    const provider = capturingProvider(captured)
    const tools = new ToolRegistry()

    tools.register(baseTool('LazyTool', {
      shouldDefer: () => true,
      searchHint: ['secret'],
    }))

    for await (const _ of runAgent(
      { text: 'just a normal question' },
      session,
      { provider: { resolveFor: () => ({ provider, model: 'm' }) } as any, tools, permission: makePermission() },
      new AbortController().signal,
    )) { /* drain */ }

    const names = (captured[0] ?? []).map(s => s.name)
    expect(names).not.toContain('LazyTool')
  })

  it('once un-deferred via searchHint, tool stays loaded in unDeferredToolNames', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    const tools = new ToolRegistry()

    tools.register(baseTool('LazyTool', {
      shouldDefer: () => true,
      searchHint: ['unlock'],
    }))

    // Simulate first turn that matches the hint
    const firstCapture: ToolSpec[][] = []
    const provider1 = capturingProvider(firstCapture)
    for await (const _ of runAgent(
      { text: 'please unlock something' },
      session,
      { provider: { resolveFor: () => ({ provider: provider1, model: 'm' }) } as any, tools, permission: makePermission() },
      new AbortController().signal,
    )) { /* drain */ }

    // After first turn, unDeferredToolNames should have LazyTool
    expect(session.unDeferredToolNames.has('LazyTool')).toBe(true)

    // Simulate second turn (no matching text) — tool should still be loaded
    const secondCapture: ToolSpec[][] = []
    const provider2 = capturingProvider(secondCapture)
    for await (const _ of runAgent(
      { text: 'unrelated message' },
      session,
      { provider: { resolveFor: () => ({ provider: provider2, model: 'm' }) } as any, tools, permission: makePermission() },
      new AbortController().signal,
    )) { /* drain */ }

    const names = (secondCapture[0] ?? []).map(s => s.name)
    expect(names).toContain('LazyTool')
  })

  it('alwaysLoad tool included even when shouldDefer would exclude it', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    const captured: ToolSpec[][] = []
    const provider = capturingProvider(captured)
    const tools = new ToolRegistry()

    // alwaysLoad takes priority (checked first in loop)
    tools.register(baseTool('AlwaysDeferred', {
      alwaysLoad: true,
      shouldDefer: () => true,
    }))

    for await (const _ of runAgent(
      { text: 'hi' },
      session,
      { provider: { resolveFor: () => ({ provider, model: 'm' }) } as any, tools, permission: makePermission() },
      new AbortController().signal,
    )) { /* drain */ }

    const names = (captured[0] ?? []).map(s => s.name)
    expect(names).toContain('AlwaysDeferred')
  })
})
