import { describe, it, expect } from 'vitest'
import { OpenAIProvider } from '../../../src/core/provider/openai'
import type { ProviderEvent } from '../../../src/core/provider/types'

function fakeStream(chunks: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c
    },
  }
}

describe('OpenAIProvider.translate', () => {
  it('translates content deltas into text_delta', async () => {
    const provider = new OpenAIProvider({
      id: 'p',
      apiKey: 'sk',
      baseUrl: 'https://api.openai.com/v1',
    })
    const chunks = [
      { choices: [{ delta: { content: 'hello' }, finish_reason: null }] },
      { choices: [{ delta: { content: ' world' }, finish_reason: null }] },
      {
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      },
    ]
    const out: ProviderEvent[] = []
    for await (const ev of provider.translateStream(fakeStream(chunks))) {
      out.push(ev)
    }
    expect(out).toEqual([
      { type: 'text_delta', text: 'hello' },
      { type: 'text_delta', text: ' world' },
      {
        type: 'message_stop',
        stopReason: 'end_turn',
        usage: { inputTokens: 5, outputTokens: 2 },
      },
    ])
  })

  it('translates streamed tool calls into tool_use_start + deltas + stop', async () => {
    const provider = new OpenAIProvider({
      id: 'p',
      apiKey: 'sk',
      baseUrl: 'https://api.openai.com/v1',
    })
    const chunks = [
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: 'call_1', type: 'function', function: { name: 'Read', arguments: '' } },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, function: { arguments: '{"path":' } },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, function: { arguments: '"a.ts"}' } },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        choices: [{ delta: {}, finish_reason: 'tool_calls' }],
        usage: { prompt_tokens: 3, completion_tokens: 7 },
      },
    ]
    const out: ProviderEvent[] = []
    for await (const ev of provider.translateStream(fakeStream(chunks))) {
      out.push(ev)
    }
    expect(out).toEqual([
      { type: 'tool_use_start', id: 'call_1', name: 'Read' },
      { type: 'tool_use_args_delta', id: 'call_1', delta: '{"path":' },
      { type: 'tool_use_args_delta', id: 'call_1', delta: '"a.ts"}' },
      { type: 'tool_use_stop', id: 'call_1', input: { path: 'a.ts' } },
      {
        type: 'message_stop',
        stopReason: 'tool_use',
        usage: { inputTokens: 3, outputTokens: 7 },
      },
    ])
  })
})
