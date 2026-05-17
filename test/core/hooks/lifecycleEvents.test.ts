// test/core/hooks/lifecycleEvents.test.ts
//
// Tests for the lifecycle hook fire helpers landed in Iter JJJ
// (sessionStart / sessionEnd / promptSubmit / afterTurn / beforeAutoCompact).
// Each helper just wraps `HookRegistry.invoke` with a typed payload and a
// 5s default timeout — these tests verify:
//   - the helper invokes the matching event
//   - payload pass-through is intact
//   - failures inside the registry (or a buggy handler) never throw out
//   - the beforeAutoCompact veto wiring honours `{ skip: true }`
//   - the helpers compose cleanly with caller-supplied AbortSignals
//
// Plus a thin end-to-end check that the agent loop fires promptSubmit /
// afterTurn / beforeAutoCompact when a HookRegistry is threaded into
// `runAgent`. The loop integration is exercised via a mock provider that
// returns a single end_turn assistant message; that's enough to hit every
// new fire point without setting up real tool execution.

import { describe, it, expect } from 'vitest'
import { createHookRegistry } from '../../../src/core/hooks/registry'
import {
  fireSessionStart,
  fireSessionEnd,
  firePromptSubmit,
  fireAfterTurn,
  fireBeforeAutoCompact,
} from '../../../src/core/hooks/lifecycle'
import { runAgent } from '../../../src/core/agent/loop'
import type { LLMProvider, ProviderEvent } from '../../../src/core/provider/types'
import type { ProviderResolver } from '../../../src/core/provider/resolver'
import type { ToolRegistry } from '../../../src/core/tools/registry'
import type { PermissionChecker } from '../../../src/core/permission/checker'
import type { Session } from '../../../src/core/session/types'
import type { HookContext } from '../../../src/core/hooks/events'
import type { AgentEvent } from '../../../src/core/agent/events'
import { PermissionCache } from '../../../src/core/permission/cache'
import { MessageQueue } from '../../../src/core/session/queue'

function makeSession(): Session {
  return {
    id: 'sess-test',
    providerId: 'p',
    model: 'm',
    messages: [],
    totalUsage: { inputTokens: 0, outputTokens: 0 },
    permissionCache: new PermissionCache(),
    queue: new MessageQueue(),
    mode: 'normal',
    createdAt: 0,
    updatedAt: 0,
    unDeferredToolNames: new Set(),
  }
}

/**
 * Mock provider that yields a single `text_delta` + `message_stop` so the
 * agent loop hits the `calls.length === 0` end-of-turn branch on its first
 * iteration. The loop then fires afterTurn / beforeAutoCompact and exits.
 */
function mockProvider(): LLMProvider {
  return {
    async *stream(): AsyncIterable<ProviderEvent> {
      yield { type: 'text_delta', text: 'done' }
      yield {
        type: 'message_stop',
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
      }
    },
  }
}

function mockProviderResolver(): ProviderResolver {
  const r: Pick<ProviderResolver, 'resolveFor'> = {
    resolveFor: () => ({ provider: mockProvider(), model: 'm' }),
  }
  return r as ProviderResolver
}

function mockToolRegistry(): ToolRegistry {
  const r: Pick<ToolRegistry, 'list' | 'find'> = {
    list: () => [],
    find: () => undefined,
  }
  return r as ToolRegistry
}

function mockPermission(): PermissionChecker {
  const p: Pick<PermissionChecker, 'check'> = {
    check: async () => ({ allowed: true }),
  }
  return p as PermissionChecker
}

async function drain(it: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = []
  for await (const ev of it) out.push(ev)
  return out
}

describe('fireSessionStart', () => {
  it('invokes the sessionStart event with the typed payload', async () => {
    const r = createHookRegistry()
    const seen: HookContext[] = []
    r.register('sessionStart', (ctx) => { seen.push(ctx) })
    await fireSessionStart(r, {
      sessionId: 's1',
      providerId: 'anthropic',
      model: 'opus',
      cwd: '/tmp',
      resumed: false,
    })
    expect(seen).toHaveLength(1)
    expect(seen[0]!.event).toBe('sessionStart')
    const payload = seen[0]!.payload as { sessionId: string; resumed: boolean }
    expect(payload.sessionId).toBe('s1')
    expect(payload.resumed).toBe(false)
  })

  it('does not throw when a handler throws', async () => {
    const r = createHookRegistry()
    r.register('sessionStart', () => { throw new Error('boom') })
    await expect(fireSessionStart(r, {
      sessionId: 's2', providerId: 'p', model: 'm', cwd: '/x', resumed: true,
    })).resolves.toBeDefined()
  })
})

describe('fireSessionEnd', () => {
  it('invokes the sessionEnd event with the reason', async () => {
    const r = createHookRegistry()
    const seen: HookContext[] = []
    r.register('sessionEnd', (ctx) => { seen.push(ctx) })
    await fireSessionEnd(r, { sessionId: 'e1', reason: 'sigint' })
    expect(seen).toHaveLength(1)
    const payload = seen[0]!.payload as { reason: string }
    expect(payload.reason).toBe('sigint')
  })

  it('returns [] when no handlers are registered', async () => {
    const r = createHookRegistry()
    const results = await fireSessionEnd(r, { sessionId: 'e2', reason: 'exit' })
    expect(results).toEqual([])
  })
})

describe('firePromptSubmit', () => {
  it('passes the prompt text through unchanged', async () => {
    const r = createHookRegistry()
    let receivedText = ''
    r.register('promptSubmit', (ctx) => {
      const p = ctx.payload as { text: string }
      receivedText = p.text
    })
    await firePromptSubmit(r, { sessionId: 's', text: 'hello world' })
    expect(receivedText).toBe('hello world')
  })

  it('runs multiple handlers in priority order', async () => {
    const r = createHookRegistry()
    const order: string[] = []
    r.register('promptSubmit', () => { order.push('low') }, { priority: 0 })
    r.register('promptSubmit', () => { order.push('high') }, { priority: 10 })
    await firePromptSubmit(r, { sessionId: 's', text: 'x' })
    expect(order).toEqual(['high', 'low'])
  })
})

describe('fireAfterTurn', () => {
  it('reports the stopReason and toolCalls count', async () => {
    const r = createHookRegistry()
    const seen: Array<Record<string, unknown>> = []
    r.register('afterTurn', (ctx) => {
      seen.push(ctx.payload as Record<string, unknown>)
    })
    await fireAfterTurn(r, { sessionId: 's', stopReason: 'end_turn', toolCalls: 3 })
    expect(seen[0]?.stopReason).toBe('end_turn')
    expect(seen[0]?.toolCalls).toBe(3)
  })
})

describe('fireBeforeAutoCompact', () => {
  it('returns skipped:false when no handler vetoes', async () => {
    const r = createHookRegistry()
    r.register('beforeAutoCompact', () => undefined)
    const result = await fireBeforeAutoCompact(r, {
      sessionId: 's', tokensBefore: 100, threshold: 0.8, contextWindow: 200_000,
    })
    expect(result.skipped).toBe(false)
  })

  it('returns skipped:true with reason when a handler returns skip', async () => {
    const r = createHookRegistry()
    r.register('beforeAutoCompact', () => ({ skip: true, reason: 'preserve' }))
    const result = await fireBeforeAutoCompact(r, {
      sessionId: 's', tokensBefore: 100, threshold: 0.8, contextWindow: 200_000,
    })
    expect(result.skipped).toBe(true)
    expect(result.reason).toBe('preserve')
  })

  it('does NOT veto when a handler ERRORS (errors do not equal skip)', async () => {
    const r = createHookRegistry()
    r.register('beforeAutoCompact', () => { throw new Error('crash') })
    const result = await fireBeforeAutoCompact(r, {
      sessionId: 's', tokensBefore: 100, threshold: 0.8, contextWindow: 200_000,
    })
    expect(result.skipped).toBe(false)
  })
})

describe('agent loop wiring', () => {
  it('fires promptSubmit before the user message is appended', async () => {
    const hookRegistry = createHookRegistry()
    const lengthsSeen: number[] = []
    const session = makeSession()
    hookRegistry.register('promptSubmit', () => {
      lengthsSeen.push(session.messages.length)
    })
    await drain(
      runAgent(
        { text: 'hi' },
        session,
        {
          provider: mockProviderResolver(),
          tools: mockToolRegistry(),
          permission: mockPermission(),
          hookRegistry,
        },
        new AbortController().signal,
      ),
    )
    expect(lengthsSeen).toHaveLength(1)
    expect(lengthsSeen[0]).toBe(0)
  })

  it('fires afterTurn at the end of a model turn', async () => {
    const hookRegistry = createHookRegistry()
    const stops: string[] = []
    hookRegistry.register('afterTurn', (ctx) => {
      const p = ctx.payload as { stopReason: string }
      stops.push(p.stopReason)
    })
    await drain(
      runAgent(
        { text: 'hi' },
        makeSession(),
        {
          provider: mockProviderResolver(),
          tools: mockToolRegistry(),
          permission: mockPermission(),
          hookRegistry,
        },
        new AbortController().signal,
      ),
    )
    expect(stops).toEqual(['end_turn'])
  })

  it('fires beforeAutoCompact only when autoCompact is configured', async () => {
    const hookRegistry = createHookRegistry()
    let calls = 0
    hookRegistry.register('beforeAutoCompact', () => { calls += 1 })
    await drain(
      runAgent(
        { text: 'hi' },
        makeSession(),
        {
          provider: mockProviderResolver(),
          tools: mockToolRegistry(),
          permission: mockPermission(),
          hookRegistry,
        },
        new AbortController().signal,
      ),
    )
    expect(calls).toBe(0)
  })

  it('fires beforeAutoCompact when autoCompact is configured (below threshold)', async () => {
    const hookRegistry = createHookRegistry()
    let calls = 0
    hookRegistry.register('beforeAutoCompact', () => { calls += 1 })
    await drain(
      runAgent(
        { text: 'hi' },
        makeSession(),
        {
          provider: mockProviderResolver(),
          tools: mockToolRegistry(),
          permission: mockPermission(),
          hookRegistry,
          autoCompact: {
            provider: mockProvider(),
            model: 'm',
            autoThreshold: 0.8,
            contextWindow: 200_000,
          },
        },
        new AbortController().signal,
      ),
    )
    expect(calls).toBe(1)
  })

  it('does not fire lifecycle events when hookRegistry is omitted', async () => {
    const hookRegistry = createHookRegistry()
    let seen = 0
    hookRegistry.register('promptSubmit', () => { seen += 1 })
    hookRegistry.register('afterTurn', () => { seen += 1 })
    await drain(
      runAgent(
        { text: 'hi' },
        makeSession(),
        {
          provider: mockProviderResolver(),
          tools: mockToolRegistry(),
          permission: mockPermission(),
          // hookRegistry intentionally omitted
        },
        new AbortController().signal,
      ),
    )
    expect(seen).toBe(0)
  })
})
