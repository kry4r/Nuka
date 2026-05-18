// test/core/agent/autoCompact.image.test.ts
//
// Regression pin: when a user message carries an ImageContentBlock alongside
// text, helpers that summarise the transcript as a plain string must skip
// the image's base64 payload (otherwise it bloats the summary by megabytes
// and leaks bytes the model never asked for).

import { describe, expect, it } from 'vitest'
import type { Message } from '../../../src/core/message/types'
import { extractTextForCompaction } from '../../../src/core/agent/autoCompact'

describe('extractTextForCompaction', () => {
  it('ignores image content blocks', () => {
    const messages: Message[] = [
      {
        role: 'user',
        id: 'u1',
        ts: 0,
        content: [
          { type: 'text', text: 'hello' },
          { type: 'image', mediaType: 'image/png', dataBase64: 'AAA=' },
        ],
      },
    ]
    expect(extractTextForCompaction(messages)).toContain('hello')
    expect(extractTextForCompaction(messages)).not.toContain('AAA=')
  })

  it('joins text across multiple messages and includes system content', () => {
    const messages: Message[] = [
      { role: 'system', content: 'sys-prompt' },
      {
        role: 'user',
        id: 'u1',
        ts: 0,
        content: [
          { type: 'text', text: 'hi' },
          { type: 'image', mediaType: 'image/png', dataBase64: 'ZZZ=' },
        ],
      },
      {
        role: 'assistant',
        id: 'a1',
        ts: 0,
        content: [{ type: 'text', text: 'reply' }],
      },
    ]
    const out = extractTextForCompaction(messages)
    expect(out).toContain('sys-prompt')
    expect(out).toContain('hi')
    expect(out).toContain('reply')
    expect(out).not.toContain('ZZZ=')
  })
})
