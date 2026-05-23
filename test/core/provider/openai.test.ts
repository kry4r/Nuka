import { describe, it, expect } from 'vitest'
import { OpenAIProvider } from '../../../src/core/provider/openai'
import type { LLMRequest, ProviderEvent } from '../../../src/core/provider/types'

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

  it('posts custom OpenAI-compatible providers to /responses', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetchFn: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} })
      const sse = [
        'data: {"type":"response.output_text.delta","delta":"ok"}',
        '',
        'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":4,"output_tokens":1}}}',
        '',
        'data: [DONE]',
        '',
      ].join('\n')
      return new Response(sse, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    }
    const provider = new OpenAIProvider({
      id: 'custom',
      apiKey: 'sk-test',
      baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
      fetchFn,
    })
    const req: LLMRequest = {
      model: 'mimo-v2-pro',
      system: 'You are concise.',
      messages: [
        {
          role: 'user',
          id: 'u1',
          ts: 0,
          content: [{ type: 'text', text: 'hello' }],
        },
      ],
      tools: [
        {
          name: 'Read',
          description: 'Read a file',
          parameters: { type: 'object', properties: { path: { type: 'string' } } },
        },
      ],
      maxTokens: 128,
      temperature: 0.2,
    }

    const out: ProviderEvent[] = []
    for await (const ev of provider.stream(req, new AbortController().signal)) {
      out.push(ev)
    }

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://token-plan-cn.xiaomimimo.com/v1/responses')
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer sk-test')
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      model: 'mimo-v2-pro',
      stream: true,
      instructions: 'You are concise.',
      input: [{ role: 'user', content: 'hello' }],
      tools: [
        {
          type: 'function',
          name: 'Read',
          description: 'Read a file',
          parameters: { type: 'object', properties: { path: { type: 'string' } } },
        },
      ],
      temperature: 0.2,
      max_output_tokens: 128,
    })
    expect(out).toEqual([
      { type: 'text_delta', text: 'ok' },
      {
        type: 'message_stop',
        stopReason: 'end_turn',
        usage: { inputTokens: 4, outputTokens: 1 },
      },
    ])
  })

  it('parses Responses SSE frames separated with CRLF', async () => {
    const fetchFn: typeof fetch = async () => {
      const sse = [
        'data: {"type":"response.output_text.delta","delta":"ok"}',
        '',
        'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":2,"output_tokens":1}}}',
        '',
        'data: [DONE]',
        '',
      ].join('\r\n')
      return new Response(sse, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    }
    const provider = new OpenAIProvider({
      id: 'custom',
      apiKey: 'sk-test',
      baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
      fetchFn,
    })
    const req: LLMRequest = {
      model: 'mimo-v2-pro',
      system: '',
      messages: [],
      tools: [],
    }

    const out: ProviderEvent[] = []
    for await (const ev of provider.stream(req, new AbortController().signal)) {
      out.push(ev)
    }

    expect(out).toEqual([
      { type: 'text_delta', text: 'ok' },
      {
        type: 'message_stop',
        stopReason: 'end_turn',
        usage: { inputTokens: 2, outputTokens: 1 },
      },
    ])
  })

  it('falls back to /v1/responses when custom baseUrl omits /v1', async () => {
    const urls: string[] = []
    const fetchFn: typeof fetch = async (url) => {
      urls.push(String(url))
      if (urls.length === 1) {
        return new Response('missing', { status: 404, statusText: 'Not Found' })
      }
      return new Response('data: [DONE]\n\n', { status: 200 })
    }
    const provider = new OpenAIProvider({
      id: 'custom-2',
      apiKey: 'sk-test',
      baseUrl: 'https://ai.example.test',
      fetchFn,
    })
    const req: LLMRequest = {
      model: 'gpt-5.5',
      system: '',
      messages: [],
      tools: [],
    }

    const out: ProviderEvent[] = []
    for await (const ev of provider.stream(req, new AbortController().signal)) {
      out.push(ev)
    }

    expect(urls).toEqual([
      'https://ai.example.test/responses',
      'https://ai.example.test/v1/responses',
    ])
    expect(out).toEqual([
      {
        type: 'message_stop',
        stopReason: 'end_turn',
        usage: { inputTokens: 0, outputTokens: 0 },
      },
    ])
  })

  it('normalizes legacy completions baseUrls to the Responses endpoint', async () => {
    const urls: string[] = []
    const fetchFn: typeof fetch = async (url) => {
      urls.push(String(url))
      return new Response('data: [DONE]\n\n', { status: 200 })
    }
    const provider = new OpenAIProvider({
      id: 'xiaomi-mimo',
      apiKey: 'sk-test',
      baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1/completions',
      fetchFn,
    })

    const out: ProviderEvent[] = []
    for await (const ev of provider.stream({
      model: 'mimo-v2-pro',
      system: '',
      messages: [],
      tools: [],
    }, new AbortController().signal)) {
      out.push(ev)
    }

    expect(urls).toEqual(['https://token-plan-cn.xiaomimimo.com/v1/responses'])
    expect(out.at(-1)).toEqual({
      type: 'message_stop',
      stopReason: 'end_turn',
      usage: { inputTokens: 0, outputTokens: 0 },
    })
  })

  it('posts custom OpenAI-compatible compaction to /responses/compact and returns raw output items', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const compactOutput = [
      { role: 'user', content: 'recent request' },
      { type: 'compaction', encrypted_content: 'ENCRYPTED_CONTEXT_COMPACTION_SUMMARY' },
    ]
    const fetchFn: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} })
      return new Response(JSON.stringify({
        id: 'resp-compact',
        output: compactOutput,
        usage: { input_tokens: 44, output_tokens: 7 },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    const provider = new OpenAIProvider({
      id: 'custom',
      apiKey: 'sk-test',
      baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
      fetchFn,
    })

    const result = await provider.compact({
      model: 'mimo-v2-pro',
      system: 'Compact this session.',
      messages: [
        { role: 'user', id: 'u1', ts: 0, content: [{ type: 'text', text: 'hello' }] },
      ],
      tools: [],
    }, new AbortController().signal)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://token-plan-cn.xiaomimimo.com/v1/responses/compact')
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer sk-test')
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      model: 'mimo-v2-pro',
      instructions: 'Compact this session.',
      input: [{ role: 'user', content: 'hello' }],
    })
    expect(result).toEqual({
      implementation: 'responses_compact',
      output: compactOutput,
      usage: { inputTokens: 44, outputTokens: 7 },
      responseId: 'resp-compact',
    })
  })

  it('falls back to /v1/responses/compact when custom baseUrl omits /v1', async () => {
    const urls: string[] = []
    const fetchFn: typeof fetch = async (url) => {
      urls.push(String(url))
      if (urls.length === 1) {
        return new Response('missing', { status: 404, statusText: 'Not Found' })
      }
      return new Response(JSON.stringify({
        output: [{ type: 'compaction', encrypted_content: 'encrypted' }],
      }), { status: 200 })
    }
    const provider = new OpenAIProvider({
      id: 'custom-2',
      apiKey: 'sk-test',
      baseUrl: 'https://ai.example.test',
      fetchFn,
    })

    const result = await provider.compact({
      model: 'gpt-5.5',
      system: '',
      messages: [],
      tools: [],
    }, new AbortController().signal)

    expect(urls).toEqual([
      'https://ai.example.test/responses/compact',
      'https://ai.example.test/v1/responses/compact',
    ])
    expect(result.output).toEqual([{ type: 'compaction', encrypted_content: 'encrypted' }])
  })

  it('normalizes legacy chat completions baseUrls to the Responses compact endpoint', async () => {
    const urls: string[] = []
    const fetchFn: typeof fetch = async (url) => {
      urls.push(String(url))
      return new Response(JSON.stringify({
        output: [{ type: 'compaction', encrypted_content: 'encrypted' }],
      }), { status: 200 })
    }
    const provider = new OpenAIProvider({
      id: 'xiaomi-mimo',
      apiKey: 'sk-test',
      baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1/chat/completions',
      fetchFn,
    })

    const result = await provider.compact({
      model: 'mimo-v2-pro',
      system: '',
      messages: [],
      tools: [],
    }, new AbortController().signal)

    expect(urls).toEqual(['https://token-plan-cn.xiaomimimo.com/v1/responses/compact'])
    expect(result.output).toEqual([{ type: 'compaction', encrypted_content: 'encrypted' }])
  })

  it('allows official OpenAI providers to use /responses/compact', async () => {
    const urls: string[] = []
    const fetchFn: typeof fetch = async (url) => {
      urls.push(String(url))
      return new Response(JSON.stringify({
        output: [{ type: 'compaction', encrypted_content: 'official-encrypted' }],
      }), { status: 200 })
    }
    const provider = new OpenAIProvider({
      id: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      fetchFn,
    })

    const result = await provider.compact({
      model: 'gpt-5.5',
      system: '',
      messages: [],
      tools: [],
    }, new AbortController().signal)

    expect(urls).toEqual(['https://api.openai.com/v1/responses/compact'])
    expect(result.output).toEqual([{ type: 'compaction', encrypted_content: 'official-encrypted' }])
  })

  it('passes saved Responses compaction items through later Responses requests', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetchFn: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} })
      return new Response('data: [DONE]\n\n', { status: 200 })
    }
    const provider = new OpenAIProvider({
      id: 'custom',
      apiKey: 'sk-test',
      baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
      fetchFn,
    })

    const out: ProviderEvent[] = []
    for await (const ev of provider.stream({
      model: 'mimo-v2-pro',
      system: '',
      messages: [
        {
          role: 'responses_compaction',
          provider: 'openai',
          id: 'compact-1',
          ts: 0,
          output: [{ type: 'compaction', encrypted_content: 'ENCRYPTED_CONTEXT_COMPACTION_SUMMARY' }],
        },
        { role: 'user', id: 'u2', ts: 1, content: [{ type: 'text', text: 'continue' }] },
      ],
      tools: [],
    }, new AbortController().signal)) {
      out.push(ev)
    }

    expect(JSON.parse(String(calls[0]!.init.body)).input).toEqual([
      { type: 'compaction', encrypted_content: 'ENCRYPTED_CONTEXT_COMPACTION_SUMMARY' },
      { role: 'user', content: 'continue' },
    ])
    expect(out.at(-1)).toEqual({
      type: 'message_stop',
      stopReason: 'end_turn',
      usage: { inputTokens: 0, outputTokens: 0 },
    })
  })

  it('translates Responses tool call events', async () => {
    const provider = new OpenAIProvider({
      id: 'custom',
      apiKey: 'sk',
      baseUrl: 'https://example.test/v1',
    })
    const chunks = [
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { id: 'fc_1', type: 'function_call', call_id: 'call_1', name: 'Read' },
      },
      {
        type: 'response.function_call_arguments.delta',
        output_index: 0,
        delta: '{"path":',
      },
      {
        type: 'response.function_call_arguments.delta',
        output_index: 0,
        delta: '"a.ts"}',
      },
      {
        type: 'response.output_item.done',
        output_index: 0,
        item: { id: 'fc_1', type: 'function_call', call_id: 'call_1', name: 'Read' },
      },
      {
        type: 'response.completed',
        response: {
          status: 'completed',
          usage: { input_tokens: 3, output_tokens: 7 },
        },
      },
    ]

    const out: ProviderEvent[] = []
    for await (const ev of provider.translateResponsesStream(fakeStream(chunks))) {
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
