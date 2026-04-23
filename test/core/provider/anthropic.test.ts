import { describe, it, expect } from 'vitest'
import { AnthropicProvider } from '../../../src/core/provider/anthropic'
import type { ProviderEvent } from '../../../src/core/provider/types'

/**
 * Mock Anthropic SDK stream. We hand-roll an async iterable that yields
 * SDK events in the same shape the real SDK emits so the translator can
 * be tested in isolation from real HTTP.
 */
function makeFakeSdkStream(events: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const e of events) yield e
    },
  }
}

describe('AnthropicProvider.translate', () => {
  it('translates content_block_delta text into text_delta events', async () => {
    const provider = new AnthropicProvider({
      id: 'p',
      apiKey: 'sk',
      baseUrl: 'https://api.anthropic.com',
    })
    const sdkEvents = [
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' there' } },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { input_tokens: 10, output_tokens: 4 },
      },
      { type: 'message_stop' },
    ]
    const out: ProviderEvent[] = []
    for await (const ev of provider.translateStream(makeFakeSdkStream(sdkEvents))) {
      out.push(ev)
    }
    expect(out).toEqual([
      { type: 'text_delta', text: 'hi' },
      { type: 'text_delta', text: ' there' },
      {
        type: 'message_stop',
        stopReason: 'end_turn',
        usage: { inputTokens: 10, outputTokens: 4 },
      },
    ])
  })

  it('translates tool_use blocks with streamed JSON input', async () => {
    const provider = new AnthropicProvider({
      id: 'p',
      apiKey: 'sk',
      baseUrl: 'https://api.anthropic.com',
    })
    const sdkEvents = [
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'tu_1', name: 'Read', input: {} },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"path":' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '"a.ts"}' },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use' },
        usage: { input_tokens: 5, output_tokens: 8 },
      },
      { type: 'message_stop' },
    ]
    const out: ProviderEvent[] = []
    for await (const ev of provider.translateStream(makeFakeSdkStream(sdkEvents))) {
      out.push(ev)
    }
    expect(out).toEqual([
      { type: 'tool_use_start', id: 'tu_1', name: 'Read' },
      { type: 'tool_use_args_delta', id: 'tu_1', delta: '{"path":' },
      { type: 'tool_use_args_delta', id: 'tu_1', delta: '"a.ts"}' },
      { type: 'tool_use_stop', id: 'tu_1', input: { path: 'a.ts' } },
      {
        type: 'message_stop',
        stopReason: 'tool_use',
        usage: { inputTokens: 5, outputTokens: 8 },
      },
    ])
  })
})
