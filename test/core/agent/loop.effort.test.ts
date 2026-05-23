// test/core/agent/loop.effort.test.ts
import { describe, it, expect } from 'vitest'
import { runAgent } from '../../../src/core/agent/loop'
import { createSession } from '../../../src/core/session/session'
import type { LLMProvider, LLMRequest, ProviderEvent } from '../../../src/core/provider/types'
import { ToolRegistry } from '../../../src/core/tools/registry'
import { PermissionChecker } from '../../../src/core/permission/checker'

function captureProvider(captured: { req?: LLMRequest }): LLMProvider {
  return {
    id: 'p',
    format: 'openai',
    async *stream(req: LLMRequest): AsyncIterable<ProviderEvent> {
      captured.req = req
      yield { type: 'text_delta', text: 'ok' }
      yield {
        type: 'message_stop',
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
      }
    },
    async listRemoteModels() { return [] },
  } as LLMProvider
}

describe('runAgent — effort plumbing', () => {
  it('forwards deps.effort to provider.stream()', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    const captured: { req?: LLMRequest } = {}
    const provider = captureProvider(captured)
    const tools = new ToolRegistry()
    const permission = new PermissionChecker(() => session.permissionCache, async () => ({ allowed: true }))

    for await (const _ of runAgent(
      { text: 'hi' },
      session,
      {
        provider: { resolveFor: () => ({ provider, model: 'm' }) } as any,
        tools,
        permission,
        effort: 'high',
      },
      new AbortController().signal,
    )) { /* drain */ }

    expect(captured.req?.effort).toBe('high')
  })

  it('omits effort when not configured', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    const captured: { req?: LLMRequest } = {}
    const provider = captureProvider(captured)
    const tools = new ToolRegistry()
    const permission = new PermissionChecker(() => session.permissionCache, async () => ({ allowed: true }))

    for await (const _ of runAgent(
      { text: 'hi' },
      session,
      {
        provider: { resolveFor: () => ({ provider, model: 'm' }) } as any,
        tools,
        permission,
      },
      new AbortController().signal,
    )) { /* drain */ }

    expect(captured.req?.effort).toBeUndefined()
  })

  it('filters configured effort when the selected model does not support it', async () => {
    const session = createSession({ providerId: 'p', model: 'gpt-4o-mini' })
    const captured: { req?: LLMRequest } = {}
    const provider = captureProvider(captured)
    const tools = new ToolRegistry()
    const permission = new PermissionChecker(() => session.permissionCache, async () => ({ allowed: true }))

    for await (const _ of runAgent(
      { text: 'hi' },
      session,
      {
        provider: { resolveFor: () => ({ provider, model: 'gpt-4o-mini' }) } as any,
        tools,
        permission,
        effort: 'high',
        resolveEffort: () => undefined,
      },
      new AbortController().signal,
    )) { /* drain */ }

    expect(captured.req?.effort).toBeUndefined()
  })
})
