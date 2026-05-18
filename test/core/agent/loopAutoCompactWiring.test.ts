// test/core/agent/loopAutoCompactWiring.test.ts
//
// 2026-05-18 unification coverage — wires `compactSessionAware` into `runAgent`
// via the single `deps.autoCompact` entry point. These tests assert the *wiring
// decision* (compact vs skip vs veto) and the event shape. The orchestrator's
// algorithm itself has dedicated coverage in `autoCompact.test.ts`.

import { describe, it, expect } from 'vitest'
import { runAgent } from '../../../src/core/agent/loop'
import { createSession } from '../../../src/core/session/session'
import type { LLMProvider, ProviderEvent } from '../../../src/core/provider/types'
import { ToolRegistry } from '../../../src/core/tools/registry'
import { PermissionChecker } from '../../../src/core/permission/checker'
import { createHookRegistry } from '../../../src/core/hooks/registry'
import type { AgentEvent } from '../../../src/core/agent/events'
import type { Message } from '../../../src/core/message/types'

function stubProvider(scripts: ProviderEvent[][]): LLMProvider {
  let i = 0
  return {
    id: 'p',
    format: 'openai',
    async *stream(): AsyncIterable<ProviderEvent> {
      const script = scripts[i++] ?? []
      for (const ev of script) yield ev
    },
    async listRemoteModels() {
      return []
    },
  } as LLMProvider
}

function makePermission(session: ReturnType<typeof createSession>): PermissionChecker {
  return new PermissionChecker(
    () => session.permissionCache,
    async () => ({ allowed: true }),
  )
}

/**
 * Build a transcript that comfortably exceeds the orchestrator's structural
 * fold threshold. The default byte-ratio in `roughTokenCountEstimation` is
 * 4 bytes per token, so ~10kb of text → ~2500 tokens of estimated pressure.
 */
function makeHeavyTranscript(): Message[] {
  const out: Message[] = []
  for (let i = 0; i < 10; i++) {
    out.push({
      role: 'user',
      id: `pre-u${i}`,
      ts: i,
      content: [{ type: 'text', text: `user msg ${i}-${'x'.repeat(500)}` }],
    })
    out.push({
      role: 'assistant',
      id: `pre-a${i}`,
      ts: i,
      content: [{ type: 'text', text: `assistant msg ${i}-${'y'.repeat(500)}` }],
    })
  }
  return out
}

/** Single-turn end_turn script — the loop terminates after one assistant turn. */
const SINGLE_TURN_END: ProviderEvent[] = [
  { type: 'text_delta', text: 'ack' },
  { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } },
]

describe('runAgent — compactSessionAware wiring', () => {
  it('compacts the transcript when totalUsage exceeds autoThreshold*contextWindow', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    session.messages = makeHeavyTranscript()
    const beforeLen = session.messages.length
    // Simulate high usage so the session-aware threshold fires
    session.totalUsage = { inputTokens: 2000, outputTokens: 1000 }

    const provider = stubProvider([SINGLE_TURN_END])
    const tools = new ToolRegistry()
    const permission = makePermission(session)

    const events: AgentEvent[] = []
    for await (const ev of runAgent(
      { text: 'go' },
      session,
      {
        provider: { resolveFor: () => ({ provider, model: 'm' }) } as never,
        tools,
        permission,
        autoCompact: { autoThreshold: 0.8, contextWindow: 1000 },
      },
      new AbortController().signal,
    )) {
      events.push(ev)
    }

    const compacted = events.find((e): e is AgentEvent & { type: 'auto_compacted' } => e.type === 'auto_compacted')
    expect(compacted).toBeDefined()
    expect(compacted!.before).toBeGreaterThan(compacted!.after)
    expect(session.messages.length).toBeLessThan(beforeLen)
  })

  it('does not compact when totalUsage is below the threshold', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    // Default totalUsage is {0,0}; after the turn it becomes {1,1} = 2 tokens
    // 2 << 160_000 (= 200_000 * 0.8) → no compact

    const provider = stubProvider([SINGLE_TURN_END])
    const tools = new ToolRegistry()
    const permission = makePermission(session)

    const events: AgentEvent[] = []
    for await (const ev of runAgent(
      { text: 'hi' },
      session,
      {
        provider: { resolveFor: () => ({ provider, model: 'm' }) } as never,
        tools,
        permission,
        autoCompact: { autoThreshold: 0.8, contextWindow: 200_000 },
      },
      new AbortController().signal,
    )) {
      events.push(ev)
    }

    expect(events.some(e => e.type === 'auto_compacted')).toBe(false)
  })

  it('does not compact when a hook vetoes via skip:true', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    session.messages = makeHeavyTranscript()
    const beforeLen = session.messages.length
    session.totalUsage = { inputTokens: 2000, outputTokens: 1000 }

    const provider = stubProvider([SINGLE_TURN_END])
    const tools = new ToolRegistry()
    const permission = makePermission(session)

    const hookRegistry = createHookRegistry()
    hookRegistry.register('beforeAutoCompact', async () => ({ skip: true, reason: 'test-veto' }))

    const events: AgentEvent[] = []
    for await (const ev of runAgent(
      { text: 'go' },
      session,
      {
        provider: { resolveFor: () => ({ provider, model: 'm' }) } as never,
        tools,
        permission,
        hookRegistry,
        autoCompact: { autoThreshold: 0.8, contextWindow: 1000 },
      },
      new AbortController().signal,
    )) {
      events.push(ev)
    }

    expect(events.some(e => e.type === 'auto_compacted')).toBe(false)
    // beforeLen pre-heavy + new user + new assistant
    expect(session.messages.length).toBe(beforeLen + 2)
  })

  it('does not compact when autoCompact is unset', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    session.messages = makeHeavyTranscript()
    const beforeLen = session.messages.length
    session.totalUsage = { inputTokens: 2000, outputTokens: 1000 }

    const provider = stubProvider([SINGLE_TURN_END])
    const tools = new ToolRegistry()
    const permission = makePermission(session)

    const events: AgentEvent[] = []
    for await (const ev of runAgent(
      { text: 'hi' },
      session,
      {
        provider: { resolveFor: () => ({ provider, model: 'm' }) } as never,
        tools,
        permission,
        // no autoCompact
      },
      new AbortController().signal,
    )) {
      events.push(ev)
    }

    expect(events.some(e => e.type === 'auto_compacted')).toBe(false)
    expect(session.messages.length).toBe(beforeLen + 2)
  })

  it('threads hookRegistry into the orchestrator so handlers see the event', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    session.messages = makeHeavyTranscript()
    session.totalUsage = { inputTokens: 2000, outputTokens: 1000 }

    const provider = stubProvider([SINGLE_TURN_END])
    const tools = new ToolRegistry()
    const permission = makePermission(session)

    const seen: Array<Record<string, unknown>> = []
    const hookRegistry = createHookRegistry()
    hookRegistry.register('beforeAutoCompact', async (ctx) => {
      seen.push(ctx.payload as Record<string, unknown>)
      return undefined
    })

    for await (const _ of runAgent(
      { text: 'go' },
      session,
      {
        provider: { resolveFor: () => ({ provider, model: 'm' }) } as never,
        tools,
        permission,
        hookRegistry,
        autoCompact: { autoThreshold: 0.8, contextWindow: 1000 },
      },
      new AbortController().signal,
    )) {
      /* drain */
    }

    expect(seen.length).toBeGreaterThanOrEqual(1)
    const payload = seen[0]!
    expect(payload['sessionId']).toBe(session.id)
    expect(typeof payload['tokensBefore']).toBe('number')
  })

  it('threads the caller AbortSignal so an early abort halts compaction', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    session.messages = makeHeavyTranscript()
    const beforeLen = session.messages.length
    session.totalUsage = { inputTokens: 2000, outputTokens: 1000 }

    const provider = stubProvider([SINGLE_TURN_END])
    const tools = new ToolRegistry()
    const permission = makePermission(session)

    const ctrl = new AbortController()
    let captured: AbortSignal | undefined
    const hookRegistry = createHookRegistry()
    hookRegistry.register('beforeAutoCompact', async (ctx) => {
      captured = ctx.signal
      // Abort *during* the hook so the orchestrator's post-hook abort
      // check (and the registry's safeInvoke) observes a cancelled signal.
      ctrl.abort()
      return undefined
    })

    for await (const _ of runAgent(
      { text: 'go' },
      session,
      {
        provider: { resolveFor: () => ({ provider, model: 'm' }) } as never,
        tools,
        permission,
        hookRegistry,
        autoCompact: { autoThreshold: 0.8, contextWindow: 1000 },
      },
      ctrl.signal,
    )) {
      /* drain — loop will exit when signal fires */
    }

    expect(captured).toBeDefined()
    // After abort we expect no full compaction swap; transcript length
    // should be the pre-heavy size + the new user+assistant turn (2),
    // i.e. no messages dropped by the orchestrator.
    expect(session.messages.length).toBe(beforeLen + 2)
  })

  it('emits auto_compacted with before/after as numbers (event shape compat)', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    session.messages = makeHeavyTranscript()
    session.totalUsage = { inputTokens: 2000, outputTokens: 1000 }

    const provider = stubProvider([SINGLE_TURN_END])
    const tools = new ToolRegistry()
    const permission = makePermission(session)

    const events: AgentEvent[] = []
    for await (const ev of runAgent(
      { text: 'go' },
      session,
      {
        provider: { resolveFor: () => ({ provider, model: 'm' }) } as never,
        tools,
        permission,
        autoCompact: { autoThreshold: 0.8, contextWindow: 1000 },
      },
      new AbortController().signal,
    )) {
      events.push(ev)
    }

    const compacted = events.find((e): e is AgentEvent & { type: 'auto_compacted' } => e.type === 'auto_compacted')
    expect(compacted).toBeDefined()
    expect(typeof compacted!.before).toBe('number')
    expect(typeof compacted!.after).toBe('number')
  })
})
