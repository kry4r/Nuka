// test/core/provider/openai.image.test.ts
//
// Verify the OpenAI message converter emits a multipart `content` array
// with an `image_url` part (base64 data URI for inline images, raw URL
// passthrough for remote URLs). Text-only user messages keep the legacy
// plain-string `content` shape so existing tests don't regress.

import { describe, expect, it } from 'vitest'
import { __test_toOpenAIMessages } from '../../../src/core/provider/openai'
import type { Message } from '../../../src/core/message/types'

type OpenAIPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

type OpenAIMessage = { role: string; content: string | OpenAIPart[] }

describe('toOpenAIMessages — image blocks', () => {
  it('emits multipart content with image_url base64 data URI', () => {
    const messages: Message[] = [
      {
        role: 'user',
        id: 'u1',
        ts: 0,
        content: [
          { type: 'text', text: 'see this' },
          { type: 'image', mediaType: 'image/png', dataBase64: 'AAA=' },
        ],
      },
    ]
    const out = __test_toOpenAIMessages('sys', messages) as OpenAIMessage[]
    const user = out.find(m => m.role === 'user')
    expect(user).toBeDefined()
    expect(user?.content).toEqual([
      { type: 'text', text: 'see this' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA=' } },
    ])
  })

  it('passes a remote url through verbatim', () => {
    const messages: Message[] = [
      {
        role: 'user',
        id: 'u1',
        ts: 0,
        content: [
          { type: 'image', mediaType: 'image/jpeg', url: 'https://example.test/x.jpg' },
        ],
      },
    ]
    const out = __test_toOpenAIMessages('sys', messages) as OpenAIMessage[]
    const user = out.find(m => m.role === 'user')
    expect(user?.content).toEqual([
      { type: 'image_url', image_url: { url: 'https://example.test/x.jpg' } },
    ])
  })

  it('keeps the legacy plain-string content shape when no images are present', () => {
    const messages: Message[] = [
      {
        role: 'user',
        id: 'u1',
        ts: 0,
        content: [{ type: 'text', text: 'hello' }],
      },
    ]
    const out = __test_toOpenAIMessages('sys', messages) as OpenAIMessage[]
    expect(out.find(m => m.role === 'user')?.content).toBe('hello')
  })
})
