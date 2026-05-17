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
  fireAfterAssistantMessage,
  fireBeforeAutoCompact,
  extractReplaceText,
  applyReplaceTextToAssistant,
} from '../../../src/core/hooks/lifecycle'
import type { AssistantMessage } from '../../../src/core/message/types'
import type { InvocationResult } from '../../../src/core/hooks/events'
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

describe('fireAfterAssistantMessage', () => {
  it('invokes the afterAssistantMessage event with the typed payload', async () => {
    const r = createHookRegistry()
    const seen: HookContext[] = []
    r.register('afterAssistantMessage', (ctx) => { seen.push(ctx) })
    await fireAfterAssistantMessage(r, {
      sessionId: 'sess-abc',
      text: 'hello   world',
    })
    expect(seen).toHaveLength(1)
    expect(seen[0]!.event).toBe('afterAssistantMessage')
    const payload = seen[0]!.payload as { sessionId: string; text: string }
    expect(payload.sessionId).toBe('sess-abc')
    expect(payload.text).toBe('hello   world')
  })

  it('does not throw when a handler throws', async () => {
    const r = createHookRegistry()
    r.register('afterAssistantMessage', () => { throw new Error('boom') })
    await expect(
      fireAfterAssistantMessage(r, { sessionId: 's', text: 'x' }),
    ).resolves.toBeDefined()
  })

  it('propagates the optional context/agentName fields', async () => {
    const r = createHookRegistry()
    const payloads: Array<Record<string, unknown>> = []
    r.register('afterAssistantMessage', (ctx) => {
      payloads.push(ctx.payload as Record<string, unknown>)
    })
    await fireAfterAssistantMessage(r, {
      sessionId: 's2',
      text: 'sub-text',
      context: 'subagent',
      agentName: 'plugin:tester',
    })
    expect(payloads[0]?.context).toBe('subagent')
    expect(payloads[0]?.agentName).toBe('plugin:tester')
  })
})

describe('agent loop wiring for afterAssistantMessage', () => {
  it('fires afterAssistantMessage BEFORE the assistant message is appended', async () => {
    const hookRegistry = createHookRegistry()
    const observed: Array<{ messageCount: number; text: string }> = []
    const session = makeSession()
    hookRegistry.register('afterAssistantMessage', (ctx) => {
      const p = ctx.payload as { text: string }
      // Fire site is now pre-append (mutable contract: handlers may
      // return `data.replaceText` to rewrite the assistant text before
      // persistence). Only the user message is on the transcript at
      // this point; the assistant message is still in flight.
      observed.push({ messageCount: session.messages.length, text: p.text })
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
    expect(observed).toHaveLength(1)
    // The mock provider yields a 'done' text_delta then message_stop, so
    // the handler should see exactly that text (text blocks only).
    expect(observed[0]?.text).toBe('done')
    // user(1) message only on the transcript when the event fires
    // (proves the event fires BEFORE appendMessage).
    expect(observed[0]?.messageCount).toBe(1)
  })

  it('honours data.replaceText to rewrite the assistant text before persistence', async () => {
    const hookRegistry = createHookRegistry()
    const session = makeSession()
    hookRegistry.register('afterAssistantMessage', () => ({
      data: { replaceText: 'REWRITTEN' },
    }))
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
    // session.messages = [user, assistant]; the assistant's text block
    // should hold the handler's replacement, not the model's 'done'.
    expect(session.messages).toHaveLength(2)
    const assistant = session.messages[1]
    expect(assistant?.role).toBe('assistant')
    if (assistant?.role !== 'assistant') return
    const texts = assistant.content
      .flatMap(b => (b.type === 'text' ? [b.text] : []))
      .join('')
    expect(texts).toBe('REWRITTEN')
  })

  it('leaves the assistant text intact when a handler returns no replaceText', async () => {
    const hookRegistry = createHookRegistry()
    const session = makeSession()
    hookRegistry.register('afterAssistantMessage', () => ({
      data: { something: 'else' },
    }))
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
    const assistant = session.messages[1]
    if (assistant?.role !== 'assistant') return
    const texts = assistant.content
      .flatMap(b => (b.type === 'text' ? [b.text] : []))
      .join('')
    // The model emitted 'done'; the handler did not request a rewrite.
    expect(texts).toBe('done')
  })

  it('accepts empty string as a valid replaceText value', async () => {
    const hookRegistry = createHookRegistry()
    const session = makeSession()
    hookRegistry.register('afterAssistantMessage', () => ({
      data: { replaceText: '' },
    }))
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
    const assistant = session.messages[1]
    if (assistant?.role !== 'assistant') return
    // Empty string IS a valid rewrite — the assistant message still
    // carries a text block, just with empty content.
    const textBlocks = assistant.content.filter(b => b.type === 'text')
    expect(textBlocks).toHaveLength(1)
    if (textBlocks[0]?.type !== 'text') return
    expect(textBlocks[0].text).toBe('')
  })

  it('last-write-wins across multiple handlers (NOT pipeline)', async () => {
    const hookRegistry = createHookRegistry()
    const session = makeSession()
    const seen: string[] = []
    // Lower priority runs LATER (priority high → low). Two handlers,
    // both see the ORIGINAL `text`; the LAST successful replaceText
    // is the one that lands.
    hookRegistry.register(
      'afterAssistantMessage',
      (ctx) => {
        const p = ctx.payload as { text: string }
        seen.push(`first:${p.text}`)
        return { data: { replaceText: 'first' } }
      },
      { priority: 10 },
    )
    hookRegistry.register(
      'afterAssistantMessage',
      (ctx) => {
        const p = ctx.payload as { text: string }
        seen.push(`second:${p.text}`)
        return { data: { replaceText: 'second' } }
      },
      { priority: 0 },
    )
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
    // Both handlers see the SAME (original) text — not 'first'.
    expect(seen).toEqual(['first:done', 'second:done'])
    const assistant = session.messages[1]
    if (assistant?.role !== 'assistant') return
    const texts = assistant.content
      .flatMap(b => (b.type === 'text' ? [b.text] : []))
      .join('')
    expect(texts).toBe('second')
  })

  it('ignores non-string replaceText values (number / object / null)', async () => {
    const hookRegistry = createHookRegistry()
    const session = makeSession()
    hookRegistry.register('afterAssistantMessage', () => ({
      data: { replaceText: 42 as unknown as string },
    }))
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
    const assistant = session.messages[1]
    if (assistant?.role !== 'assistant') return
    const texts = assistant.content
      .flatMap(b => (b.type === 'text' ? [b.text] : []))
      .join('')
    // Non-string ⇒ "no replacement requested" ⇒ original text preserved.
    expect(texts).toBe('done')
  })

  it('does not fire afterAssistantMessage when hookRegistry is omitted', async () => {
    const hookRegistry = createHookRegistry()
    let seen = 0
    hookRegistry.register('afterAssistantMessage', () => { seen += 1 })
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

describe('extractReplaceText', () => {
  function makeResult(data: Record<string, unknown> | undefined): InvocationResult {
    return {
      id: 'h',
      event: 'afterAssistantMessage',
      outcome: 'success',
      result: data === undefined ? undefined : { data },
    }
  }

  it('returns undefined when no handler returns replaceText', () => {
    expect(extractReplaceText([])).toBeUndefined()
    expect(extractReplaceText([makeResult(undefined)])).toBeUndefined()
    expect(extractReplaceText([makeResult({})])).toBeUndefined()
    expect(
      extractReplaceText([makeResult({ other: 'value' })]),
    ).toBeUndefined()
  })

  it('returns the last string replaceText (last-write-wins)', () => {
    const v = extractReplaceText([
      makeResult({ replaceText: 'first' }),
      makeResult({ replaceText: 'second' }),
    ])
    expect(v).toBe('second')
  })

  it('treats empty string as a valid replacement', () => {
    expect(extractReplaceText([makeResult({ replaceText: '' })])).toBe('')
  })

  it('ignores non-string values', () => {
    expect(
      extractReplaceText([
        makeResult({ replaceText: 42 }),
        makeResult({ replaceText: null }),
        makeResult({ replaceText: { x: 1 } }),
      ]),
    ).toBeUndefined()
  })

  it('skips errored / aborted results', () => {
    const errored: InvocationResult = {
      id: 'h1',
      event: 'afterAssistantMessage',
      outcome: 'error',
      error: new Error('boom'),
    }
    const aborted: InvocationResult = {
      id: 'h2',
      event: 'afterAssistantMessage',
      outcome: 'aborted',
    }
    expect(
      extractReplaceText([errored, aborted, makeResult({ replaceText: 'ok' })]),
    ).toBe('ok')
  })
})

describe('applyReplaceTextToAssistant', () => {
  function assistantWith(content: AssistantMessage['content']): AssistantMessage {
    return {
      role: 'assistant',
      id: 'm1',
      ts: 0,
      content,
    }
  }

  it('replaces all text blocks with a single text block at the first text-block index', () => {
    const m = assistantWith([
      { type: 'text', text: 'first' },
      { type: 'tool_use', id: 't1', name: 'X', input: {} },
      { type: 'text', text: 'second' },
    ])
    applyReplaceTextToAssistant(m, 'REWRITTEN')
    expect(m.content).toEqual([
      { type: 'text', text: 'REWRITTEN' },
      { type: 'tool_use', id: 't1', name: 'X', input: {} },
    ])
  })

  it('preserves the relative position of interleaved tool_use blocks', () => {
    const m = assistantWith([
      { type: 'tool_use', id: 't0', name: 'A', input: {} },
      { type: 'text', text: 'middle' },
      { type: 'tool_use', id: 't1', name: 'B', input: {} },
    ])
    applyReplaceTextToAssistant(m, 'NEW')
    expect(m.content).toEqual([
      { type: 'tool_use', id: 't0', name: 'A', input: {} },
      { type: 'text', text: 'NEW' },
      { type: 'tool_use', id: 't1', name: 'B', input: {} },
    ])
  })

  it('prepends a text block when the message had none', () => {
    const m = assistantWith([
      { type: 'tool_use', id: 't0', name: 'A', input: {} },
      { type: 'tool_use', id: 't1', name: 'B', input: {} },
    ])
    applyReplaceTextToAssistant(m, 'hello')
    expect(m.content).toEqual([
      { type: 'text', text: 'hello' },
      { type: 'tool_use', id: 't0', name: 'A', input: {} },
      { type: 'tool_use', id: 't1', name: 'B', input: {} },
    ])
  })

  it('writes an empty string into the replacement block', () => {
    const m = assistantWith([{ type: 'text', text: 'original' }])
    applyReplaceTextToAssistant(m, '')
    expect(m.content).toEqual([{ type: 'text', text: '' }])
  })
})
