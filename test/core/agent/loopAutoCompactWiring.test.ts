// test/core/agent/loopAutoCompactWiring.test.ts
//
// Iter VVV coverage — wires the Iter TTT `maybeAutoCompactPure`
// orchestrator into `runAgent`. These tests assert the *wiring decision*
// (call vs skip vs swap) and the backward-compat envelope around the
// legacy session-aware `compact/auto.ts` path. Provider integration is
// stubbed; the orchestrator's algorithm itself has dedicated coverage in
// `autoCompact.test.ts`.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  runAgent,
  isPureAutoCompactEnabled,
} from '../../../src/core/agent/loop'
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
 * Build a transcript that comfortably exceeds the orchestrator's
 * `triggerTokens`. The default byte-ratio in `roughTokenCountEstimation`
 * is 4 bytes per token, so ~10kb of text → ~2500 tokens of estimated
 * pressure — safely above a trigger of 200 and below our typical target.
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

describe('isPureAutoCompactEnabled — gate logic', () => {
  const prevEnv = process.env['NUKA_AUTOCOMPACT_MODE']

  beforeEach(() => {
    delete process.env['NUKA_AUTOCOMPACT_MODE']
  })

  afterEach(() => {
    if (prevEnv === undefined) delete process.env['NUKA_AUTOCOMPACT_MODE']
    else process.env['NUKA_AUTOCOMPACT_MODE'] = prevEnv
  })

  it('returns false when autoCompactPure is absent', () => {
    expect(isPureAutoCompactEnabled({})).toBe(false)
  })

  it('returns false when autoCompactPure.mode is "session" (default)', () => {
    expect(
      isPureAutoCompactEnabled({
        autoCompactPure: {
          mode: 'session',
          config: { triggerTokens: 100, targetTokens: 50 },
        },
      }),
    ).toBe(false)
  })

  it('returns true when autoCompactPure.mode === "pure"', () => {
    expect(
      isPureAutoCompactEnabled({
        autoCompactPure: {
          mode: 'pure',
          config: { triggerTokens: 100, targetTokens: 50 },
        },
      }),
    ).toBe(true)
  })

  it('returns true when NUKA_AUTOCOMPACT_MODE=pure even with mode=session', () => {
    process.env['NUKA_AUTOCOMPACT_MODE'] = 'pure'
    expect(
      isPureAutoCompactEnabled({
        autoCompactPure: {
          mode: 'session',
          config: { triggerTokens: 100, targetTokens: 50 },
        },
      }),
    ).toBe(true)
  })

  it('returns false when env var is set but autoCompactPure is absent', () => {
    process.env['NUKA_AUTOCOMPACT_MODE'] = 'pure'
    expect(isPureAutoCompactEnabled({})).toBe(false)
  })
})

describe('runAgent — pure auto-compact wiring', () => {
  const prevEnv = process.env['NUKA_AUTOCOMPACT_MODE']

  beforeEach(() => {
    delete process.env['NUKA_AUTOCOMPACT_MODE']
  })

  afterEach(() => {
    if (prevEnv === undefined) delete process.env['NUKA_AUTOCOMPACT_MODE']
    else process.env['NUKA_AUTOCOMPACT_MODE'] = prevEnv
  })

  it('compacts the transcript when mode=pure and tokens exceed trigger', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    session.messages = makeHeavyTranscript()
    const beforeLen = session.messages.length

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
        autoCompactPure: {
          mode: 'pure',
          config: { triggerTokens: 200, targetTokens: 800, preserveRecent: 4 },
        },
      },
      new AbortController().signal,
    )) {
      events.push(ev)
    }

    const compacted = events.find((e): e is AgentEvent & { type: 'auto_compacted' } => e.type === 'auto_compacted')
    expect(compacted).toBeDefined()
    expect(compacted!.before).toBeGreaterThan(compacted!.after)
    // Transcript should be shorter than before. The new assistant turn was
    // appended after the compaction kicked in on the previous turn end, so
    // we compare against the post-compaction-plus-new-turn length: at
    // worst, the new length is materially smaller than the pre-heavy
    // length (preserveRecent caps the tail).
    expect(session.messages.length).toBeLessThan(beforeLen)
  })

  it('does not compact when mode=pure but tokens are below trigger', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })

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
        autoCompactPure: {
          mode: 'pure',
          config: { triggerTokens: 100_000, targetTokens: 50_000 },
        },
      },
      new AbortController().signal,
    )) {
      events.push(ev)
    }

    expect(events.some(e => e.type === 'auto_compacted')).toBe(false)
  })

  it('does not compact when mode=pure but a hook vetoes via skip:true', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    session.messages = makeHeavyTranscript()
    const beforeLen = session.messages.length

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
        autoCompactPure: {
          mode: 'pure',
          config: { triggerTokens: 200, targetTokens: 800 },
        },
      },
      new AbortController().signal,
    )) {
      events.push(ev)
    }

    expect(events.some(e => e.type === 'auto_compacted')).toBe(false)
    // beforeLen pre-heavy + new user + new assistant
    expect(session.messages.length).toBe(beforeLen + 2)
  })

  it('does not compact when autoCompactPure is unset (mode unset, no new behaviour)', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    session.messages = makeHeavyTranscript()
    const beforeLen = session.messages.length

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
      },
      new AbortController().signal,
    )) {
      events.push(ev)
    }

    expect(events.some(e => e.type === 'auto_compacted')).toBe(false)
    expect(session.messages.length).toBe(beforeLen + 2)
  })

  it('does not compact when autoCompactPure.mode is "session" (default opt-out)', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    session.messages = makeHeavyTranscript()
    const beforeLen = session.messages.length

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
        autoCompactPure: {
          mode: 'session',
          config: { triggerTokens: 200, targetTokens: 800 },
        },
      },
      new AbortController().signal,
    )) {
      events.push(ev)
    }

    expect(events.some(e => e.type === 'auto_compacted')).toBe(false)
    expect(session.messages.length).toBe(beforeLen + 2)
  })

  it('compacts when env var NUKA_AUTOCOMPACT_MODE=pure is set even with mode=session', async () => {
    process.env['NUKA_AUTOCOMPACT_MODE'] = 'pure'

    const session = createSession({ providerId: 'p', model: 'm' })
    session.messages = makeHeavyTranscript()

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
        autoCompactPure: {
          mode: 'session',
          config: { triggerTokens: 200, targetTokens: 800 },
        },
      },
      new AbortController().signal,
    )) {
      events.push(ev)
    }

    expect(events.some(e => e.type === 'auto_compacted')).toBe(true)
  })

  it('threads hookRegistry into the orchestrator so handlers see the event', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    session.messages = makeHeavyTranscript()

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
        autoCompactPure: {
          mode: 'pure',
          config: { triggerTokens: 200, targetTokens: 800 },
        },
      },
      new AbortController().signal,
    )) {
      /* drain */
    }

    expect(seen.length).toBeGreaterThanOrEqual(1)
    const payload = seen[0]!
    expect(payload['sessionId']).toBe(session.id)
    expect(typeof payload['tokensBefore']).toBe('number')
    expect(payload['threshold']).toBe(200)
  })

  it('threads the caller AbortSignal so an early abort halts compaction', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    session.messages = makeHeavyTranscript()
    const beforeLen = session.messages.length

    const provider = stubProvider([SINGLE_TURN_END])
    const tools = new ToolRegistry()
    const permission = makePermission(session)

    const ctrl = new AbortController()
    let captured: AbortSignal | undefined
    const hookRegistry = createHookRegistry()
    hookRegistry.register('beforeAutoCompact', async (ctx) => {
      captured = ctx.signal
      // Abort *during* the hook so the orchestrator's post-hook abort
      // check (and the registry's safeInvoke) observes a cancelled
      // signal.
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
        autoCompactPure: {
          mode: 'pure',
          config: { triggerTokens: 200, targetTokens: 800 },
        },
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
        autoCompactPure: {
          mode: 'pure',
          config: { triggerTokens: 200, targetTokens: 800 },
        },
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

  it('passes config.sessionId through (overrides default session.id)', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    session.messages = makeHeavyTranscript()

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
        autoCompactPure: {
          mode: 'pure',
          config: {
            triggerTokens: 200,
            targetTokens: 800,
            sessionId: 'explicit-id',
          },
        },
      },
      new AbortController().signal,
    )) {
      /* drain */
    }

    expect(seen[0]!['sessionId']).toBe('explicit-id')
  })

  it('default sessionId on the orchestrator falls back to session.id when config omits it', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    session.messages = makeHeavyTranscript()

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
        autoCompactPure: {
          mode: 'pure',
          config: { triggerTokens: 200, targetTokens: 800 },
        },
      },
      new AbortController().signal,
    )) {
      /* drain */
    }

    expect(seen[0]!['sessionId']).toBe(session.id)
  })

  it('does not affect the legacy session-aware path when autoCompact is unset and autoCompactPure is enabled', async () => {
    // Sanity check: previously the loop required `deps.autoCompact` to be
    // set for any compaction to happen. The new path is independent — it
    // can run without `deps.autoCompact` being configured. This test
    // pins the independence so a future refactor doesn't accidentally
    // couple them again.
    const session = createSession({ providerId: 'p', model: 'm' })
    session.messages = makeHeavyTranscript()

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
        // explicitly NO autoCompact opts
        autoCompactPure: {
          mode: 'pure',
          config: { triggerTokens: 200, targetTokens: 800 },
        },
      },
      new AbortController().signal,
    )) {
      events.push(ev)
    }

    expect(events.some(e => e.type === 'auto_compacted')).toBe(true)
  })
})
