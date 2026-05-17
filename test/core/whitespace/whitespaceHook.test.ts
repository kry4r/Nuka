// test/core/whitespace/whitespaceHook.test.ts
//
// Tests for `createWhitespaceHookHandler` — the opt-in
// `afterAssistantMessage` hook that runs `whitespace.normalize` over the
// assembled assistant text. Currently observer-only: the handler reports
// the normalized form via `data.whitespaceNormalize`, but the fire site
// in `agent/loop.ts` ignores the return value (the message has already
// been persisted by the time the event fires).
//
// Coverage:
//   1. Direct handler invocation with a synthetic `HookContext`.
//   2. End-to-end via the real `HookRegistry` + `fireAfterAssistantMessage`,
//      asserting the diagnostic reaches an observer.

import { describe, it, expect } from 'vitest'
import { createHookRegistry } from '../../../src/core/hooks/registry'
import { fireAfterAssistantMessage } from '../../../src/core/hooks/lifecycle'
import {
  createWhitespaceHookHandler,
  type WhitespaceNormalizeDiagnostic,
} from '../../../src/core/whitespace/whitespaceHook'
import type {
  HookContext,
  HookResult,
} from '../../../src/core/hooks/events'

function makeCtx(text: unknown): HookContext {
  return {
    event: 'afterAssistantMessage',
    payload: { sessionId: 's', text },
  }
}

async function call(
  handler: ReturnType<typeof createWhitespaceHookHandler>,
  ctx: HookContext,
): Promise<HookResult> {
  const ret = await handler(ctx)
  return ret ?? {}
}

describe('createWhitespaceHookHandler — direct handler invocation', () => {
  it('returns a diagnostic AND replaceText on text that needs normalization', async () => {
    const handler = createWhitespaceHookHandler()
    const dirty = '  \n    line1  \n\n\n    line2  \n  \n'
    const res = await call(handler, makeCtx(dirty))
    const diag = res.data?.whitespaceNormalize as WhitespaceNormalizeDiagnostic | undefined
    expect(diag).toBeDefined()
    expect(diag!.original).toBe(dirty)
    expect(diag!.changed).toBe(true)
    // Default normalize() defaults: dedent + trimTrailing + collapseBlanks
    // + trimEdges + LF — the dirty input collapses to two indented lines.
    expect(diag!.normalized).toBe('line1\n\nline2\n')
    // New mutable contract: changed === true ⇒ replaceText carries
    // the normalized form so the fire site can rewrite the assistant
    // text before persistence.
    expect(res.data?.['replaceText']).toBe('line1\n\nline2\n')
  })

  it('reports changed:false AND omits replaceText when input is already normalized', async () => {
    const handler = createWhitespaceHookHandler()
    const clean = 'line1\n\nline2\n'
    const res = await call(handler, makeCtx(clean))
    const diag = res.data?.whitespaceNormalize as WhitespaceNormalizeDiagnostic | undefined
    expect(diag).toBeDefined()
    expect(diag!.changed).toBe(false)
    expect(diag!.normalized).toBe(clean)
    // No-op normalize MUST NOT set replaceText — see whitespaceHook.ts
    // header for rationale (avoid spurious content-block reshape).
    expect(res.data?.['replaceText']).toBeUndefined()
  })

  it('skips when ctx.event is not afterAssistantMessage', async () => {
    const handler = createWhitespaceHookHandler()
    const ctx: HookContext = {
      event: 'afterTurn',
      payload: { text: 'something' },
    }
    const res = await call(handler, ctx)
    expect(res).toEqual({})
  })

  it('skips when payload is missing', async () => {
    const handler = createWhitespaceHookHandler()
    const ctx: HookContext = { event: 'afterAssistantMessage' }
    const res = await call(handler, ctx)
    expect(res).toEqual({})
  })

  it('skips when text is not a string', async () => {
    const handler = createWhitespaceHookHandler()
    const res = await call(handler, makeCtx(42))
    expect(res).toEqual({})
  })

  it('skips when text is shorter than minLength', async () => {
    const handler = createWhitespaceHookHandler({ minLength: 100 })
    const res = await call(handler, makeCtx('short'))
    expect(res).toEqual({})
  })

  it('forwards custom normalize options', async () => {
    const handler = createWhitespaceHookHandler({
      normalize: { lineEndings: 'crlf', collapseBlanks: false, trimEdges: false },
    })
    const res = await call(handler, makeCtx('a\nb\n'))
    const diag = res.data?.whitespaceNormalize as WhitespaceNormalizeDiagnostic | undefined
    expect(diag).toBeDefined()
    expect(diag!.normalized).toBe('a\r\nb\r\n')
  })

  it('throws on invalid minLength at construction time', () => {
    expect(() => createWhitespaceHookHandler({ minLength: -1 })).toThrow(RangeError)
    expect(() => createWhitespaceHookHandler({ minLength: 1.5 })).toThrow(RangeError)
  })
})

describe('createWhitespaceHookHandler — agent-loop end-to-end', () => {
  it('rewrites the assistant text via replaceText when wired into runAgent', async () => {
    // Lazy imports keep the rest of the file usable when the agent-loop
    // surface is not desired (e.g. running this file in isolation).
    const { createHookRegistry: mkReg } = await import('../../../src/core/hooks/registry')
    const { runAgent } = await import('../../../src/core/agent/loop')
    const { PermissionCache } = await import('../../../src/core/permission/cache')
    const { MessageQueue } = await import('../../../src/core/session/queue')
    type ProviderModule = typeof import('../../../src/core/provider/types')
    type ProviderResolverModule = typeof import('../../../src/core/provider/resolver')
    type ToolRegistryModule = typeof import('../../../src/core/tools/registry')
    type PermissionCheckerModule = typeof import('../../../src/core/permission/checker')

    // Mock provider that streams the dirty text the model would emit.
    // The whitespace handler must rewrite this to the normalized form
    // before appendMessage lands it on session.messages.
    const dirty = 'foo  \nbar  \n\n\n\nbaz  \n'
    const normalized = 'foo\nbar\n\nbaz\n'

    type ProviderEvent = ProviderModule['ProviderEvent']
    const provider = {
      // eslint-disable-next-line require-yield, @typescript-eslint/require-await
      async *stream(): AsyncIterable<ProviderEvent> {
        yield { type: 'text_delta', text: dirty } as ProviderEvent
        yield {
          type: 'message_stop',
          stopReason: 'end_turn',
          usage: { inputTokens: 1, outputTokens: 1 },
        } as ProviderEvent
      },
    } as ProviderModule['LLMProvider']

    const providerResolver = {
      resolveFor: () => ({ provider, model: 'm' }),
    } as ProviderResolverModule['ProviderResolver']

    const toolRegistry = {
      list: () => [],
      find: () => undefined,
    } as unknown as ToolRegistryModule['ToolRegistry']

    const permission = {
      check: async () => ({ allowed: true }),
    } as unknown as PermissionCheckerModule['PermissionChecker']

    const session = {
      id: 's-e2e',
      providerId: 'p',
      model: 'm',
      messages: [],
      totalUsage: { inputTokens: 0, outputTokens: 0 },
      permissionCache: new PermissionCache(),
      queue: new MessageQueue(),
      mode: 'normal' as const,
      createdAt: 0,
      updatedAt: 0,
      unDeferredToolNames: new Set<string>(),
    }

    const registry = mkReg()
    registry.register(
      'afterAssistantMessage',
      createWhitespaceHookHandler(),
      { id: 'ws-e2e' },
    )

    // Drain the agent stream.
    for await (const _ of runAgent(
      { text: 'hi' },
      session,
      {
        provider: providerResolver,
        tools: toolRegistry,
        permission,
        hookRegistry: registry,
      },
      new AbortController().signal,
    )) {
      void _
    }

    expect(session.messages).toHaveLength(2)
    const assistant = session.messages[1]
    if (assistant.role !== 'assistant') throw new Error('expected assistant message')
    const texts = assistant.content
      .flatMap(b => (b.type === 'text' ? [b.text] : []))
      .join('')
    // The dirty text was rewritten to the normalized form on the way
    // into session.messages.
    expect(texts).toBe(normalized)
  })
})

describe('createWhitespaceHookHandler — registry round-trip', () => {
  it('fires through fireAfterAssistantMessage and reaches the observer', async () => {
    const registry = createHookRegistry()
    registry.register(
      'afterAssistantMessage',
      createWhitespaceHookHandler(),
      { id: 'whitespace-normalize-observer' },
    )
    const results = await fireAfterAssistantMessage(registry, {
      sessionId: 's',
      text: 'foo  \nbar  \n\n\n\nbaz  \n',
    })
    expect(results).toHaveLength(1)
    const r = results[0]!
    expect(r.outcome).toBe('success')
    if (r.outcome !== 'success') return
    const diag = r.result?.data?.whitespaceNormalize as WhitespaceNormalizeDiagnostic | undefined
    expect(diag).toBeDefined()
    expect(diag!.changed).toBe(true)
    expect(diag!.original).toBe('foo  \nbar  \n\n\n\nbaz  \n')
    // Default normalize trims trailing space per line + collapses 3 blank
    // lines down to a single blank.
    expect(diag!.normalized).toBe('foo\nbar\n\nbaz\n')
  })

  it('a second observer can read the original text via the same fire payload', async () => {
    const registry = createHookRegistry()
    let observedOriginal = ''
    registry.register(
      'afterAssistantMessage',
      createWhitespaceHookHandler(),
      { id: 'whitespace-normalize-observer' },
    )
    registry.register('afterAssistantMessage', (ctx) => {
      const p = ctx.payload as { text: string }
      observedOriginal = p.text
    })
    await fireAfterAssistantMessage(registry, {
      sessionId: 's',
      text: 'abc  \n',
    })
    // The second observer sees the same raw payload — handlers do NOT
    // see each other's return values (registry is observer-fan-out for
    // lifecycle events).
    expect(observedOriginal).toBe('abc  \n')
  })
})
