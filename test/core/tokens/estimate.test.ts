// test/core/tokens/estimate.test.ts
import { describe, expect, it } from 'vitest'
import type { Message } from '../../../src/core/message/types'
import {
  DEFAULT_BYTES_PER_TOKEN,
  IMAGE_BLOCK_TOKEN_COST,
  bytesPerTokenForFileType,
  roughTokenCountEstimation,
  roughTokenCountEstimationForBlock,
  roughTokenCountEstimationForFileType,
  roughTokenCountEstimationForMessage,
  roughTokenCountEstimationForMessages,
} from '../../../src/core/tokens/estimate'

describe('roughTokenCountEstimation', () => {
  it('returns 0 for empty input', () => {
    expect(roughTokenCountEstimation('')).toBe(0)
  })

  it('rounds chars/4 by default', () => {
    // 8 chars -> 2 tokens
    expect(roughTokenCountEstimation('abcdefgh')).toBe(2)
    // 10 chars -> 3 tokens (2.5 rounded)
    expect(roughTokenCountEstimation('1234567890')).toBe(3)
  })

  it('honors a custom bytes-per-token ratio', () => {
    expect(roughTokenCountEstimation('abcdefgh', 2)).toBe(4)
    expect(roughTokenCountEstimation('abcdefgh', 8)).toBe(1)
  })

  it('throws RangeError for non-positive ratios', () => {
    expect(() => roughTokenCountEstimation('abc', 0)).toThrow(RangeError)
    expect(() => roughTokenCountEstimation('abc', -1)).toThrow(RangeError)
  })
})

describe('bytesPerTokenForFileType', () => {
  it('maps JSON-like extensions to 2', () => {
    expect(bytesPerTokenForFileType('json')).toBe(2)
    expect(bytesPerTokenForFileType('jsonl')).toBe(2)
    expect(bytesPerTokenForFileType('jsonc')).toBe(2)
  })

  it('strips a leading dot and lowercases', () => {
    expect(bytesPerTokenForFileType('.JSON')).toBe(2)
    expect(bytesPerTokenForFileType('.Jsonl')).toBe(2)
  })

  it('falls back to the default for unknown extensions', () => {
    expect(bytesPerTokenForFileType('ts')).toBe(DEFAULT_BYTES_PER_TOKEN)
    expect(bytesPerTokenForFileType('md')).toBe(DEFAULT_BYTES_PER_TOKEN)
    expect(bytesPerTokenForFileType('')).toBe(DEFAULT_BYTES_PER_TOKEN)
  })
})

describe('roughTokenCountEstimationForFileType', () => {
  it('uses the dense ratio for JSON', () => {
    // 8 chars / 2 = 4 tokens for json vs 2 for plaintext
    expect(roughTokenCountEstimationForFileType('abcdefgh', 'json')).toBe(4)
    expect(roughTokenCountEstimationForFileType('abcdefgh', 'txt')).toBe(2)
  })
})

describe('roughTokenCountEstimationForBlock', () => {
  it('estimates text blocks by char count', () => {
    expect(
      roughTokenCountEstimationForBlock({ type: 'text', text: 'abcdefgh' }),
    ).toBe(2)
  })

  it('estimates tool_use as name + JSON-stringified input', () => {
    const tokens = roughTokenCountEstimationForBlock({
      type: 'tool_use',
      id: 'tu_1',
      name: 'Read',
      input: { file_path: '/tmp/x.ts' },
    })
    // "Read" + JSON.stringify({"file_path":"/tmp/x.ts"}) = "Read" + 28 chars = 32 -> 8 tokens
    expect(tokens).toBeGreaterThan(5)
    expect(tokens).toBeLessThan(15)
  })

  it('does not crash on cyclic tool_use input', () => {
    const obj: Record<string, unknown> = { a: 1 }
    obj.self = obj
    const tokens = roughTokenCountEstimationForBlock({
      type: 'tool_use',
      id: 'tu_2',
      name: 'X',
      input: obj,
    })
    expect(tokens).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(tokens)).toBe(true)
  })

  it('returns the flat image cost for image blocks', () => {
    expect(
      roughTokenCountEstimationForBlock({
        type: 'image',
        path: '/tmp/a.png',
        mimeType: 'image/png',
      }),
    ).toBe(IMAGE_BLOCK_TOKEN_COST)
  })

  it('counts the inline text of a resource block, 0 when URI-only', () => {
    expect(
      roughTokenCountEstimationForBlock({
        type: 'resource',
        uri: 'file:///x',
      }),
    ).toBe(0)
    expect(
      roughTokenCountEstimationForBlock({
        type: 'resource',
        uri: 'file:///x',
        text: 'abcdefgh', // 2 tokens
      }),
    ).toBe(2)
  })
})

describe('roughTokenCountEstimationForMessage', () => {
  it('sums blocks for a user message', () => {
    const m: Message = {
      role: 'user',
      id: 'u1',
      ts: 0,
      content: [
        { type: 'text', text: 'abcdefgh' }, // 2
        { type: 'text', text: '1234' }, // 1
      ],
    }
    expect(roughTokenCountEstimationForMessage(m)).toBe(3)
  })

  it('handles string-valued tool messages', () => {
    const m: Message = {
      role: 'tool',
      toolUseId: 'tu_1',
      content: 'abcdefgh',
      isError: false,
      id: 't1',
      ts: 0,
    }
    expect(roughTokenCountEstimationForMessage(m)).toBe(2)
  })

  it('handles ContentBlock-array tool messages including images', () => {
    const m: Message = {
      role: 'tool',
      toolUseId: 'tu_1',
      content: [
        { type: 'text', text: 'abcdefgh' }, // 2
        { type: 'image', path: '/tmp/x.png', mimeType: 'image/png' }, // 2000
      ],
      isError: false,
      id: 't2',
      ts: 0,
    }
    expect(roughTokenCountEstimationForMessage(m)).toBe(2002)
  })

  it('estimates system messages as plain text', () => {
    const m: Message = {
      role: 'system',
      content: 'abcdefgh',
    }
    expect(roughTokenCountEstimationForMessage(m)).toBe(2)
  })
})

describe('roughTokenCountEstimationForMessages', () => {
  it('totals across a transcript', () => {
    const msgs: Message[] = [
      {
        role: 'user',
        id: 'u',
        ts: 0,
        content: [{ type: 'text', text: 'abcdefgh' }],
      },
      {
        role: 'assistant',
        id: 'a',
        ts: 1,
        content: [{ type: 'text', text: '12341234' }],
      },
    ]
    expect(roughTokenCountEstimationForMessages(msgs)).toBe(4)
  })

  it('returns 0 for an empty transcript', () => {
    expect(roughTokenCountEstimationForMessages([])).toBe(0)
  })
})
