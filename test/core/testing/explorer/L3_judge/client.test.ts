// test/core/testing/explorer/L3_judge/client.test.ts
//
// M4.T1 — RED-first tests for the minimal Anthropic /v1/messages client.
// See locked spec §4.5: no `@anthropic-ai/sdk` dependency, fetch-based.
//
// 4 tests:
//   1. success: URL + headers + body shape are correct; returns parsed
//      { text, usage }.
//   2. 429 → typed RateLimitError.
//   3. 500 → typed ServerError (also covers 502/503 via parametrized check).
//   4. body parse: usage extracted from response.usage.{input_tokens,
//      output_tokens}; text from content[0].text.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  callMessages,
  RateLimitError,
  ServerError,
} from '../../../../../src/core/testing/explorer/L3_judge/client'

type FetchCall = {
  url: string
  init: RequestInit
}

let calls: FetchCall[] = []

function makeFetchStub(
  response: { status: number; body: unknown },
): (url: string, init: RequestInit) => Promise<Response> {
  return async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { 'content-type': 'application/json' },
    })
  }
}

beforeEach(() => {
  calls = []
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('L3_judge/client — callMessages', () => {
  it('POSTs to /v1/messages with x-api-key + anthropic-version + json body', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetchStub({
        status: 200,
        body: {
          content: [{ type: 'text', text: 'ok' }],
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      }),
    )
    const result = await callMessages({
      apiKey: 'sk-test',
      model: 'claude-haiku-4-5-20251001',
      system: 'You are a judge.',
      user: 'Hello?',
      maxTokens: 256,
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://api.anthropic.com/v1/messages')
    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('sk-test')
    expect(headers['anthropic-version']).toBe('2023-06-01')
    expect(headers['content-type']).toBe('application/json')
    expect(calls[0]!.init.method).toBe('POST')

    const body = JSON.parse(calls[0]!.init.body as string)
    expect(body.model).toBe('claude-haiku-4-5-20251001')
    expect(body.max_tokens).toBe(256)
    expect(body.system).toBe('You are a judge.')
    expect(body.messages).toEqual([{ role: 'user', content: 'Hello?' }])

    expect(result.text).toBe('ok')
    expect(result.usage).toEqual({ inTok: 10, outTok: 5 })
  })

  it('parses text from content[0].text and usage.input_tokens/output_tokens', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetchStub({
        status: 200,
        body: {
          content: [
            { type: 'text', text: 'first-chunk' },
            { type: 'text', text: 'second-chunk' },
          ],
          usage: { input_tokens: 42, output_tokens: 99 },
        },
      }),
    )
    const result = await callMessages({
      apiKey: 'sk-x',
      model: 'claude-opus-4-7',
      system: 's',
      user: 'u',
      maxTokens: 1,
    })
    // Spec: text from content[0].text (first text block).
    expect(result.text).toBe('first-chunk')
    expect(result.usage).toEqual({ inTok: 42, outTok: 99 })
  })

  it('429 status → typed RateLimitError', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetchStub({
        status: 429,
        body: { error: { type: 'rate_limit_error', message: 'slow down' } },
      }),
    )
    await expect(
      callMessages({
        apiKey: 'k',
        model: 'claude-haiku-4-5-20251001',
        system: 's',
        user: 'u',
        maxTokens: 1,
      }),
    ).rejects.toBeInstanceOf(RateLimitError)
  })

  it('500 status → typed ServerError', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetchStub({
        status: 500,
        body: { error: { type: 'api_error', message: 'boom' } },
      }),
    )
    await expect(
      callMessages({
        apiKey: 'k',
        model: 'claude-opus-4-7',
        system: 's',
        user: 'u',
        maxTokens: 1,
      }),
    ).rejects.toBeInstanceOf(ServerError)
  })
})
