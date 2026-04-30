import { describe, it, expect } from 'vitest'
import { createCacheSafeParams } from '../../../src/core/agent/forkedAgent'
import { makeUserMessage } from '../../../src/core/message/factories'

describe('createCacheSafeParams', () => {
  it('snapshots system prompt + tools + last N messages', () => {
    const session = {
      id: 'sess-1', providerId: 'anthropic', model: 'claude-opus-4-7',
      messages: Array.from({ length: 50 }, (_, i) => makeUserMessage({ text: `m${i}` })),
    } as never
    const registry = {
      list: () => [{
        name: 'Read', description: 'd',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        source: 'builtin' as const,
        tags: ['core'],
        needsPermission: () => 'none' as const,
        run: async () => ({ output: '', isError: false }),
      }],
    } as never
    const out = createCacheSafeParams({
      parentSession: session, registry, systemPrompt: 'sys', maxFork: 30,
    })
    expect(out.systemPrompt).toBe('sys')
    expect(out.modelParams.model).toBe('claude-opus-4-7')
    expect(out.tools.length).toBe(1)
    expect(out.forkContextMessages.length).toBe(30)
    const last = out.forkContextMessages.at(-1)!
    // UserMessage: content[0].text
    expect((last as { content: Array<{ text: string }> }).content[0]!.text).toBe('m49')
  })

  it('returns a stable snapshot across two calls with the same inputs', () => {
    const session = {
      id: 's', providerId: 'p', model: 'm',
      messages: [makeUserMessage({ text: 'x' })],
    } as never
    const registry = { list: () => [] } as never
    const a = createCacheSafeParams({ parentSession: session, registry, systemPrompt: 'sys' })
    const b = createCacheSafeParams({ parentSession: session, registry, systemPrompt: 'sys' })
    // Compare structurally (messages already share IDs since we made one)
    expect(a.systemPrompt).toBe(b.systemPrompt)
    expect(a.modelParams.model).toBe(b.modelParams.model)
    expect(a.forkContextMessages.length).toBe(b.forkContextMessages.length)
  })
})
