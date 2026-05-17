// test/core/agents/dispatchHookThreading.test.ts
//
// Iter RRR — `dispatchAgent` now accepts an optional `hookRegistry` and
// fires the four lifecycle events that make sense for an isolated
// sub-session (sessionStart / promptSubmit / afterTurn / sessionEnd),
// each carrying `context: 'subagent'` and `agentName`.
//
// These tests pin the wiring directly against `dispatchAgent` with a
// stub provider — that's the seam the agent loop and `dispatchTool`
// both ride on, so it exercises the full surface without spinning up
// the main interactive loop.

import { describe, it, expect } from 'vitest'
import { dispatchAgent } from '../../../src/core/agents/dispatch'
import { createHookRegistry } from '../../../src/core/hooks/registry'
import { ToolRegistry } from '../../../src/core/tools/registry'
import { PermissionChecker } from '../../../src/core/permission/checker'
import { PermissionCache } from '../../../src/core/permission/cache'
import type { LLMProvider, ProviderEvent } from '../../../src/core/provider/types'
import type { ProviderResolver } from '../../../src/core/provider/resolver'
import type { ResolvedAgentDef } from '../../../src/core/agents/types'
import type { HookContext } from '../../../src/core/hooks/events'

function stubProvider(scripts: ProviderEvent[][]): LLMProvider {
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

function exploderProvider(): LLMProvider {
  return {
    id: 'p',
    format: 'openai',
    async *stream() { throw new Error('provider exploded') },
    async listRemoteModels() { return [] },
  } as LLMProvider
}

function makeResolver(provider: LLMProvider): ProviderResolver {
  return {
    resolveFor: () => ({ provider, model: 'm' }),
    listProviders: () => [{ id: 'p' } as unknown as never],
  } as unknown as ProviderResolver
}

function makeAgent(overrides: Partial<ResolvedAgentDef> = {}): ResolvedAgentDef {
  return {
    name: 'core:reviewer',
    description: 'reviews code',
    systemPrompt: 'You are a reviewer.',
    maxTurns: 20,
    pluginName: 'core',
    ...overrides,
  }
}

const permissionCache = new PermissionCache()
const permission = new PermissionChecker(() => permissionCache, async () => ({ allowed: true }))

/** A simple text-only response script that ends the turn naturally. */
const endTurnScript: ProviderEvent[][] = [
  [
    { type: 'text_delta', text: 'ok' },
    { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } },
  ],
]

describe('dispatchAgent hookRegistry threading', () => {
  it('does not fire any lifecycle event when hookRegistry is omitted', async () => {
    // Build a registry we keep an eye on, but never thread it in.
    const r = createHookRegistry()
    let saw = 0
    r.register('sessionStart', () => { saw += 1 })
    r.register('sessionEnd', () => { saw += 1 })
    r.register('promptSubmit', () => { saw += 1 })
    r.register('afterTurn', () => { saw += 1 })

    await dispatchAgent({
      agent: makeAgent(),
      task: 'silence please',
      registry: new ToolRegistry(),
      providerResolver: makeResolver(stubProvider(endTurnScript)),
      permission,
      signal: new AbortController().signal,
      parentSession: { providerId: 'p', model: 'm' },
      // hookRegistry intentionally omitted
    })
    expect(saw).toBe(0)
  })

  it('fires sessionStart with context=subagent and agentName', async () => {
    const r = createHookRegistry()
    const seen: HookContext[] = []
    r.register('sessionStart', (ctx) => { seen.push(ctx) })

    await dispatchAgent({
      agent: makeAgent({ name: 'core:peek' }),
      task: 'task',
      registry: new ToolRegistry(),
      providerResolver: makeResolver(stubProvider(endTurnScript)),
      permission,
      signal: new AbortController().signal,
      parentSession: { providerId: 'p', model: 'm' },
      hookRegistry: r,
    })
    expect(seen).toHaveLength(1)
    const payload = seen[0]!.payload as { context?: string; agentName?: string; providerId: string }
    expect(payload.context).toBe('subagent')
    expect(payload.agentName).toBe('core:peek')
    expect(payload.providerId).toBe('p')
  })

  it('fires promptSubmit before the first user message lands on the transcript', async () => {
    const r = createHookRegistry()
    // We capture the message count via a tool the sub-agent invokes; but a
    // simpler signal is the text shape — the seed message should include
    // the context string when one is provided. Promote that to the assertion
    // since promptSubmit fires regardless of tool calls.
    let receivedText: string | undefined
    r.register('promptSubmit', (ctx) => {
      const p = ctx.payload as { text: string; context?: string }
      receivedText = p.text
      expect(p.context).toBe('subagent')
    })
    await dispatchAgent({
      agent: makeAgent(),
      task: 'do thing',
      context: 'extra context here',
      registry: new ToolRegistry(),
      providerResolver: makeResolver(stubProvider(endTurnScript)),
      permission,
      signal: new AbortController().signal,
      parentSession: { providerId: 'p', model: 'm' },
      hookRegistry: r,
    })
    expect(receivedText).toContain('do thing')
    expect(receivedText).toContain('extra context here')
  })

  it('fires afterTurn when the sub-agent ends naturally', async () => {
    const r = createHookRegistry()
    const stops: string[] = []
    r.register('afterTurn', (ctx) => {
      const p = ctx.payload as { stopReason: string; context?: string; agentName?: string }
      expect(p.context).toBe('subagent')
      expect(p.agentName).toBe('core:reviewer')
      stops.push(p.stopReason)
    })
    await dispatchAgent({
      agent: makeAgent(),
      task: 't',
      registry: new ToolRegistry(),
      providerResolver: makeResolver(stubProvider(endTurnScript)),
      permission,
      signal: new AbortController().signal,
      parentSession: { providerId: 'p', model: 'm' },
      hookRegistry: r,
    })
    expect(stops).toEqual(['end_turn'])
  })

  it('fires sessionEnd with reason=completed on a clean exit', async () => {
    const r = createHookRegistry()
    const seen: HookContext[] = []
    r.register('sessionEnd', (ctx) => { seen.push(ctx) })
    await dispatchAgent({
      agent: makeAgent(),
      task: 't',
      registry: new ToolRegistry(),
      providerResolver: makeResolver(stubProvider(endTurnScript)),
      permission,
      signal: new AbortController().signal,
      parentSession: { providerId: 'p', model: 'm' },
      hookRegistry: r,
    })
    expect(seen).toHaveLength(1)
    const p = seen[0]!.payload as { reason: string; context?: string; agentName?: string }
    expect(p.reason).toBe('completed')
    expect(p.context).toBe('subagent')
    expect(p.agentName).toBe('core:reviewer')
  })

  it('fires sessionEnd exactly once (no duplicate at maxTurns)', async () => {
    const r = createHookRegistry()
    let count = 0
    r.register('sessionEnd', () => { count += 1 })

    // Force the maxTurns exit by giving a provider that always tool-uses.
    const looping: LLMProvider = {
      id: 'p',
      format: 'openai',
      async *stream() {
        yield { type: 'tool_use_start', id: 't0', name: 'Read' }
        yield { type: 'tool_use_stop', id: 't0', input: {} }
        yield { type: 'message_stop', stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1 } }
      },
      async listRemoteModels() { return [] },
    } as LLMProvider

    const registry = new ToolRegistry()
    registry.register({
      name: 'Read',
      description: 'r',
      parameters: { type: 'object', properties: {} },
      source: 'builtin',
      needsPermission: () => 'none',
      run: async () => ({ output: 'ok', isError: false }),
    })

    await dispatchAgent({
      agent: makeAgent({ allowedTools: ['Read'] }),
      task: 'spin',
      registry,
      providerResolver: makeResolver(looping),
      permission,
      signal: new AbortController().signal,
      parentSession: { providerId: 'p', model: 'm' },
      maxTurns: 2,
      hookRegistry: r,
    })
    expect(count).toBe(1)
  })

  it('fires sessionEnd with reason=aborted when the provider throws', async () => {
    const r = createHookRegistry()
    const reasons: string[] = []
    r.register('sessionEnd', (ctx) => {
      const p = ctx.payload as { reason: string }
      reasons.push(p.reason)
    })
    const result = await dispatchAgent({
      agent: makeAgent(),
      task: 't',
      registry: new ToolRegistry(),
      providerResolver: makeResolver(exploderProvider()),
      permission,
      signal: new AbortController().signal,
      parentSession: { providerId: 'p', model: 'm' },
      hookRegistry: r,
    })
    expect(result.isError).toBe(true)
    expect(reasons).toEqual(['aborted'])
  })

  it('fires sessionEnd with reason=aborted when the signal is pre-aborted', async () => {
    const r = createHookRegistry()
    const reasons: string[] = []
    r.register('sessionEnd', (ctx) => {
      const p = ctx.payload as { reason: string }
      reasons.push(p.reason)
    })
    const ctrl = new AbortController()
    ctrl.abort()
    await dispatchAgent({
      agent: makeAgent(),
      task: 't',
      registry: new ToolRegistry(),
      providerResolver: makeResolver(stubProvider(endTurnScript)),
      permission,
      signal: ctrl.signal,
      parentSession: { providerId: 'p', model: 'm' },
      hookRegistry: r,
    })
    expect(reasons).toEqual(['aborted'])
  })

  it('fire order is sessionStart → promptSubmit → afterTurn → sessionEnd', async () => {
    const r = createHookRegistry()
    const order: string[] = []
    r.register('sessionStart', () => { order.push('sessionStart') })
    r.register('promptSubmit', () => { order.push('promptSubmit') })
    r.register('afterTurn', () => { order.push('afterTurn') })
    r.register('sessionEnd', () => { order.push('sessionEnd') })

    await dispatchAgent({
      agent: makeAgent(),
      task: 't',
      registry: new ToolRegistry(),
      providerResolver: makeResolver(stubProvider(endTurnScript)),
      permission,
      signal: new AbortController().signal,
      parentSession: { providerId: 'p', model: 'm' },
      hookRegistry: r,
    })
    expect(order).toEqual(['sessionStart', 'promptSubmit', 'afterTurn', 'sessionEnd'])
  })

  it('parent registry handlers observe sub-agent events (Option A shared registry)', async () => {
    // The whole point of Option A: the parent's registry sees subagent events.
    // We verify by registering a handler the way the parent would, then
    // dispatching with that same registry threaded in.
    const r = createHookRegistry()
    const contexts: string[] = []
    r.register('promptSubmit', (ctx) => {
      const p = ctx.payload as { context?: string }
      contexts.push(p.context ?? 'main')
    })

    // First — simulate a main-loop fire with no context (legacy JJJ shape).
    // We do this by firing the helper directly with no `context` field.
    const { firePromptSubmit } = await import('../../../src/core/hooks/lifecycle')
    await firePromptSubmit(r, { sessionId: 'main', text: 'from main' })

    // Then dispatch a sub-agent through the SAME registry.
    await dispatchAgent({
      agent: makeAgent(),
      task: 'from subagent',
      registry: new ToolRegistry(),
      providerResolver: makeResolver(stubProvider(endTurnScript)),
      permission,
      signal: new AbortController().signal,
      parentSession: { providerId: 'p', model: 'm' },
      hookRegistry: r,
    })
    // Parent handler saw both contexts.
    expect(contexts).toEqual(['main', 'subagent'])
  })

  it('sub-agent context is independent: fresh sessionId per dispatch', async () => {
    const r = createHookRegistry()
    const ids: string[] = []
    r.register('sessionStart', (ctx) => {
      const p = ctx.payload as { sessionId: string }
      ids.push(p.sessionId)
    })

    for (let i = 0; i < 3; i++) {
      await dispatchAgent({
        agent: makeAgent(),
        task: `t${i}`,
        registry: new ToolRegistry(),
        providerResolver: makeResolver(stubProvider(endTurnScript)),
        permission,
        signal: new AbortController().signal,
        parentSession: { providerId: 'p', model: 'm' },
        hookRegistry: r,
      })
    }
    expect(ids).toHaveLength(3)
    expect(new Set(ids).size).toBe(3)
  })

  it('handler errors during sessionStart do NOT crash dispatch', async () => {
    const r = createHookRegistry()
    r.register('sessionStart', () => { throw new Error('boom') })
    const result = await dispatchAgent({
      agent: makeAgent(),
      task: 't',
      registry: new ToolRegistry(),
      providerResolver: makeResolver(stubProvider(endTurnScript)),
      permission,
      signal: new AbortController().signal,
      parentSession: { providerId: 'p', model: 'm' },
      hookRegistry: r,
    })
    expect(result.isError).toBe(false)
    expect(result.output).toBe('ok')
  })

  it('handler errors during afterTurn do NOT crash dispatch', async () => {
    const r = createHookRegistry()
    r.register('afterTurn', () => { throw new Error('boom') })
    const result = await dispatchAgent({
      agent: makeAgent(),
      task: 't',
      registry: new ToolRegistry(),
      providerResolver: makeResolver(stubProvider(endTurnScript)),
      permission,
      signal: new AbortController().signal,
      parentSession: { providerId: 'p', model: 'm' },
      hookRegistry: r,
    })
    expect(result.isError).toBe(false)
  })

  it('afterTurn carries the model stopReason from the final assistant message', async () => {
    const r = createHookRegistry()
    let seenStop: string | undefined
    r.register('afterTurn', (ctx) => {
      const p = ctx.payload as { stopReason: string }
      seenStop = p.stopReason
    })
    const script: ProviderEvent[][] = [[
      { type: 'text_delta', text: 'final' },
      { type: 'message_stop', stopReason: 'max_tokens', usage: { inputTokens: 1, outputTokens: 1 } },
    ]]
    await dispatchAgent({
      agent: makeAgent(),
      task: 't',
      registry: new ToolRegistry(),
      providerResolver: makeResolver(stubProvider(script)),
      permission,
      signal: new AbortController().signal,
      parentSession: { providerId: 'p', model: 'm' },
      hookRegistry: r,
    })
    expect(seenStop).toBe('max_tokens')
  })
})
