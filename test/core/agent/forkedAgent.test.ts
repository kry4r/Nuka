import { describe, it, expect } from 'vitest'
import { createCacheSafeParams } from '../../../src/core/agent/forkedAgent'
import { makeUserMessage } from '../../../src/core/message/factories'
import { runForkedAgent } from '../../../src/core/agent/forkedAgent'
import type { LLMProvider, ProviderEvent } from '../../../src/core/provider/types'

function fakeProvider(events: ProviderEvent[]): LLMProvider {
  return {
    id: 'fake', format: 'anthropic',
    async *stream() { for (const ev of events) yield ev },
    async listRemoteModels() { return [] },
  }
}

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

describe('runForkedAgent', () => {
  it('returns text from the fake provider and reports usage', async () => {
    const provider = fakeProvider([
      { type: 'text_delta', text: 'hello fork' },
      { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 100, outputTokens: 5 } },
    ])
    const out = await runForkedAgent({
      params: { systemPrompt: 'sys', tools: [], modelParams: { model: 'm' }, forkContextMessages: [] },
      prompt: 'do thing',
      provider,
      signal: new AbortController().signal,
    })
    expect(out.text).toBe('hello fork')
    expect(out.usage.inputTokens).toBe(100)
    expect(out.usage.outputTokens).toBe(5)
  })

  it('canUseTool deny prevents tool execution', async () => {
    let toolRan = false
    const tool = {
      name: 'Read', description: 'd',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      source: 'builtin' as const,
      tags: ['core'],
      needsPermission: () => 'none' as const,
      run: async () => { toolRan = true; return { output: 'x', isError: false } },
    }
    const provider = fakeProvider([
      { type: 'tool_use_start', id: 't1', name: 'Read' },
      { type: 'tool_use_stop', id: 't1', input: {} },
      { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } },
    ])
    const out = await runForkedAgent({
      params: { systemPrompt: 's', tools: [tool], modelParams: { model: 'm' }, forkContextMessages: [] },
      prompt: 'go',
      provider,
      signal: new AbortController().signal,
      canUseTool: () => false,
    })
    expect(toolRan).toBe(false)
    expect(out.text).toBeDefined()
  })
})
