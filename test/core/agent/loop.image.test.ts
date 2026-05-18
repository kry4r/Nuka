// test/core/agent/loop.image.test.ts
//
// Verifies that `runAgent` accepts an optional `images` array on its input
// shape and forwards them onto the user message that lands in the session
// transcript. Provider is a one-shot fake that yields `message_stop`
// immediately so the loop exits after the first iteration.

import { describe, it, expect } from 'vitest'
import { runAgent } from '../../../src/core/agent/loop'
import { createSession } from '../../../src/core/session/session'
import type { LLMProvider, LLMRequest, ProviderEvent } from '../../../src/core/provider/types'
import type { ProviderResolver } from '../../../src/core/provider/resolver'
import { ToolRegistry } from '../../../src/core/tools/registry'
import { PermissionChecker } from '../../../src/core/permission/checker'

function makeOneShotProvider(): LLMProvider {
  return {
    id: 'fake',
    format: 'anthropic',
    async *stream(_req: LLMRequest, _signal: AbortSignal): AsyncIterable<ProviderEvent> {
      yield {
        type: 'message_stop',
        stopReason: 'end_turn',
        usage: { inputTokens: 0, outputTokens: 0 },
      }
    },
    async listRemoteModels() { return [] },
  }
}

describe('runAgent — image input', () => {
  it('appends a user message whose content carries the image block', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    const provider = makeOneShotProvider()
    const tools = new ToolRegistry()
    const permission = new PermissionChecker(
      () => session.permissionCache,
      async () => ({ allowed: true }),
    )
    const resolver = {
      resolveFor: () => ({ provider, model: 'fake-model' }),
    } as unknown as ProviderResolver

    const ctrl = new AbortController()
    for await (const _ev of runAgent(
      {
        text: 'look',
        images: [{ type: 'image', mediaType: 'image/png', dataBase64: 'AAA=' }],
      },
      session,
      { provider: resolver, tools, permission },
      ctrl.signal,
    )) { /* drain */ }

    const userMsg = session.messages.find(m => m.role === 'user')
    expect(userMsg).toBeDefined()
    if (userMsg?.role !== 'user') return
    expect(userMsg.content).toEqual([
      { type: 'text', text: 'look' },
      { type: 'image', mediaType: 'image/png', dataBase64: 'AAA=' },
    ])
  })

  it('keeps the existing text-only call signature working (images optional)', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    const provider = makeOneShotProvider()
    const tools = new ToolRegistry()
    const permission = new PermissionChecker(
      () => session.permissionCache,
      async () => ({ allowed: true }),
    )
    const resolver = {
      resolveFor: () => ({ provider, model: 'fake-model' }),
    } as unknown as ProviderResolver

    const ctrl = new AbortController()
    for await (const _ev of runAgent(
      { text: 'hi' },
      session,
      { provider: resolver, tools, permission },
      ctrl.signal,
    )) { /* drain */ }

    const userMsg = session.messages.find(m => m.role === 'user')
    expect(userMsg).toBeDefined()
    if (userMsg?.role !== 'user') return
    expect(userMsg.content).toEqual([{ type: 'text', text: 'hi' }])
  })
})
