// test/core/provider/anthropic.image.test.ts
//
// Verify the Anthropic message converter emits the API's `image` content
// block when a user message carries an ImageContentBlock with base64 data,
// and falls back to a text marker for remote URLs (Anthropic does not
// accept remote URLs for inline images).

import { describe, expect, it } from 'vitest'
import { __test_toAnthropicMessages } from '../../../src/core/provider/anthropic'
import type { Message } from '../../../src/core/message/types'

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image'
      source: { type: string; media_type: string; data: string }
    }

type AnthropicMessage = { role: string; content: AnthropicContentBlock[] }

describe('toAnthropicMessages — image blocks', () => {
  it('emits base64 source for image with dataBase64', () => {
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
    const out = __test_toAnthropicMessages(messages) as AnthropicMessage[]
    expect(out).toHaveLength(1)
    expect(out[0]?.role).toBe('user')
    expect(out[0]?.content).toEqual([
      { type: 'text', text: 'see this' },
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'AAA=' },
      },
    ])
  })

  it('falls back to a text marker for url-only image (Anthropic does not accept remote URLs)', () => {
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
    const out = __test_toAnthropicMessages(messages) as AnthropicMessage[]
    expect(out[0]?.content).toEqual([
      { type: 'text', text: '[image: https://example.test/x.jpg (remote URL not supported by Anthropic)]' },
    ])
  })

  it('emits a "(no data)" text marker when neither dataBase64 nor url is present', () => {
    const messages: Message[] = [
      {
        role: 'user',
        id: 'u1',
        ts: 0,
        content: [
          { type: 'image', mediaType: 'image/png' },
        ],
      },
    ]
    const out = __test_toAnthropicMessages(messages) as AnthropicMessage[]
    expect(out[0]?.content).toEqual([
      { type: 'text', text: '[image: (no data)]' },
    ])
  })
})
