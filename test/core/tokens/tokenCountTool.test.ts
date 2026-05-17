// test/core/tokens/tokenCountTool.test.ts
import { describe, expect, it } from 'vitest'
import type { Message } from '../../../src/core/message/types'
import {
  TOKEN_COUNT_TOOL_NAME,
  TokenCountTool,
  runTokenCountTool,
  type TokenCountToolInput,
} from '../../../src/core/tokens/tokenCountTool'

const ctx = {
  signal: new AbortController().signal,
  cwd: process.cwd(),
}

function parse<T = unknown>(out: string | unknown): T {
  if (typeof out !== 'string') throw new Error('expected string output')
  return JSON.parse(out) as T
}

describe('TokenCountTool — metadata', () => {
  it('exposes the expected tool name constant', () => {
    expect(TOKEN_COUNT_TOOL_NAME).toBe('TokenCount')
    expect(TokenCountTool.name).toBe(TOKEN_COUNT_TOOL_NAME)
  })

  it('declares the action enum with count/estimate/budget', () => {
    const params = TokenCountTool.parameters as {
      required?: string[]
      properties?: { action?: { enum?: string[] } }
    }
    expect(params.required).toContain('action')
    expect(params.properties?.action?.enum).toEqual([
      'count',
      'estimate',
      'budget',
    ])
  })

  it('is read-only, parallel-safe, no permission required', () => {
    expect(TokenCountTool.annotations?.readOnly).toBe(true)
    expect(TokenCountTool.annotations?.parallelSafe).toBe(true)
    expect(
      TokenCountTool.needsPermission({ action: 'count', text: '' }),
    ).toBe('none')
  })
})

describe('TokenCountTool — action=count', () => {
  it('returns 0 tokens for empty text', async () => {
    const r = await TokenCountTool.run({ action: 'count', text: '' }, ctx)
    expect(r.isError).toBe(false)
    const p = parse<{ action: string; tokens: number; chars: number }>(
      r.output,
    )
    expect(p.action).toBe('count')
    expect(p.tokens).toBe(0)
    expect(p.chars).toBe(0)
  })

  it('rounds 8 chars / 4 to 2 tokens at default ratio', async () => {
    const r = await TokenCountTool.run(
      { action: 'count', text: 'abcdefgh' },
      ctx,
    )
    expect(r.isError).toBe(false)
    const p = parse<{
      tokens: number
      chars: number
      bytesPerToken: number
    }>(r.output)
    expect(p.tokens).toBe(2)
    expect(p.chars).toBe(8)
    expect(p.bytesPerToken).toBe(4)
  })

  it('uses the dense 2-byte ratio when fileExtension="json"', async () => {
    const r = await TokenCountTool.run(
      { action: 'count', text: 'abcdefgh', fileExtension: 'json' },
      ctx,
    )
    expect(r.isError).toBe(false)
    const p = parse<{
      tokens: number
      bytesPerToken: number
      fileExtension?: string
    }>(r.output)
    // 8 chars / 2 = 4 tokens
    expect(p.tokens).toBe(4)
    expect(p.bytesPerToken).toBe(2)
    expect(p.fileExtension).toBe('json')
  })

  it('strips a leading dot and lowercases the extension hint', async () => {
    const r = await TokenCountTool.run(
      { action: 'count', text: 'abcdefgh', fileExtension: '.JSONL' },
      ctx,
    )
    expect(r.isError).toBe(false)
    const p = parse<{ fileExtension?: string; bytesPerToken: number }>(
      r.output,
    )
    expect(p.fileExtension).toBe('jsonl')
    expect(p.bytesPerToken).toBe(2)
  })

  it('falls back to the default ratio for unknown extensions', async () => {
    const r = await TokenCountTool.run(
      { action: 'count', text: 'abcdefgh', fileExtension: '.xyz' },
      ctx,
    )
    expect(r.isError).toBe(false)
    const p = parse<{ bytesPerToken: number; tokens: number }>(r.output)
    expect(p.bytesPerToken).toBe(4)
    expect(p.tokens).toBe(2)
  })

  it('errors when text is missing for action=count', async () => {
    const r = await TokenCountTool.run(
      { action: 'count' } as TokenCountToolInput,
      ctx,
    )
    expect(r.isError).toBe(true)
    expect(r.output).toMatch(/text.*required/i)
  })

  it('errors when text is not a string', async () => {
    const r = await TokenCountTool.run(
      { action: 'count', text: 123 as unknown as string },
      ctx,
    )
    expect(r.isError).toBe(true)
    expect(r.output).toMatch(/text.*string/i)
  })
})

describe('TokenCountTool — action=estimate', () => {
  it('returns 0 for an empty message list', async () => {
    const r = await TokenCountTool.run(
      { action: 'estimate', messages: [] },
      ctx,
    )
    expect(r.isError).toBe(false)
    const p = parse<{ action: string; tokens: number; messageCount: number }>(
      r.output,
    )
    expect(p.action).toBe('estimate')
    expect(p.tokens).toBe(0)
    expect(p.messageCount).toBe(0)
  })

  it('estimates a user+assistant transcript', async () => {
    const messages: Message[] = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'abcdefgh' }], // 2 tokens
        id: 'u1',
        ts: 0,
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: '12345678' }], // 2 tokens
        id: 'a1',
        ts: 1,
      },
    ]
    const r = await TokenCountTool.run(
      { action: 'estimate', messages },
      ctx,
    )
    expect(r.isError).toBe(false)
    const p = parse<{ tokens: number; messageCount: number }>(r.output)
    expect(p.tokens).toBe(4)
    expect(p.messageCount).toBe(2)
  })

  it('errors when messages is missing', async () => {
    const r = await TokenCountTool.run(
      { action: 'estimate' } as TokenCountToolInput,
      ctx,
    )
    expect(r.isError).toBe(true)
    expect(r.output).toMatch(/messages.*required/i)
  })

  it('errors when messages is not an array of valid roles', async () => {
    const r = await TokenCountTool.run(
      {
        action: 'estimate',
        messages: [{ role: 'bogus' } as unknown as Message],
      },
      ctx,
    )
    expect(r.isError).toBe(true)
    expect(r.output).toMatch(/messages.*Message/i)
  })
})

describe('TokenCountTool — action=budget', () => {
  it('computes remaining + fractions at typical mid-window usage', async () => {
    const r = await TokenCountTool.run(
      { action: 'budget', used: 5000, total: 20000 },
      ctx,
    )
    expect(r.isError).toBe(false)
    const p = parse<{
      used: number
      total: number
      remaining: number
      fractionUsed: number
      fractionRemaining: number
    }>(r.output)
    expect(p.used).toBe(5000)
    expect(p.total).toBe(20000)
    expect(p.remaining).toBe(15000)
    expect(p.fractionUsed).toBeCloseTo(0.25, 10)
    expect(p.fractionRemaining).toBeCloseTo(0.75, 10)
  })

  it('clamps remaining to 0 when used exceeds total', async () => {
    const r = await TokenCountTool.run(
      { action: 'budget', used: 30000, total: 20000 },
      ctx,
    )
    expect(r.isError).toBe(false)
    const p = parse<{
      remaining: number
      fractionUsed: number
      fractionRemaining: number
    }>(r.output)
    expect(p.remaining).toBe(0)
    expect(p.fractionUsed).toBe(1.5)
    expect(p.fractionRemaining).toBe(0)
  })

  it('handles used=0 (fresh window)', async () => {
    const r = await TokenCountTool.run(
      { action: 'budget', used: 0, total: 100 },
      ctx,
    )
    expect(r.isError).toBe(false)
    const p = parse<{
      remaining: number
      fractionUsed: number
      fractionRemaining: number
    }>(r.output)
    expect(p.remaining).toBe(100)
    expect(p.fractionUsed).toBe(0)
    expect(p.fractionRemaining).toBe(1)
  })

  it('errors when total is missing', async () => {
    const r = await TokenCountTool.run(
      { action: 'budget', used: 10 } as TokenCountToolInput,
      ctx,
    )
    expect(r.isError).toBe(true)
    expect(r.output).toMatch(/total.*required/i)
  })

  it('errors when total is zero or negative', async () => {
    const r1 = await TokenCountTool.run(
      { action: 'budget', used: 0, total: 0 },
      ctx,
    )
    expect(r1.isError).toBe(true)
    expect(r1.output).toMatch(/total.*positive/i)

    const r2 = await TokenCountTool.run(
      { action: 'budget', used: 0, total: -10 },
      ctx,
    )
    expect(r2.isError).toBe(true)
    expect(r2.output).toMatch(/total.*positive/i)
  })

  it('errors when used is negative', async () => {
    const r = await TokenCountTool.run(
      { action: 'budget', used: -1, total: 100 },
      ctx,
    )
    expect(r.isError).toBe(true)
    expect(r.output).toMatch(/used.*non-negative/i)
  })

  it('errors when used is not finite', async () => {
    const r = await TokenCountTool.run(
      { action: 'budget', used: Number.NaN, total: 100 },
      ctx,
    )
    expect(r.isError).toBe(true)
    expect(r.output).toMatch(/used.*finite/i)
  })
})

describe('TokenCountTool — generic dispatch errors', () => {
  it('errors on unknown action', async () => {
    const r = await TokenCountTool.run(
      { action: 'bogus' } as unknown as TokenCountToolInput,
      ctx,
    )
    expect(r.isError).toBe(true)
    expect(r.output).toMatch(/unknown action/i)
  })

  it('errors when action is missing/not-a-string', async () => {
    const r = await TokenCountTool.run(
      {} as TokenCountToolInput,
      ctx,
    )
    expect(r.isError).toBe(true)
    expect(r.output).toMatch(/action.*string/i)
  })

  it('errors when input is not an object', async () => {
    const r = await TokenCountTool.run(
      null as unknown as TokenCountToolInput,
      ctx,
    )
    expect(r.isError).toBe(true)
    expect(r.output).toMatch(/input.*object/i)
  })
})

describe('runTokenCountTool — direct pure helper', () => {
  it('matches the JSON-stringified payload from run()', async () => {
    const input: TokenCountToolInput = {
      action: 'count',
      text: 'abcdefgh',
      fileExtension: 'json',
    }
    const direct = runTokenCountTool(input)
    const r = await TokenCountTool.run(input, ctx)
    expect(r.isError).toBe(false)
    expect(parse(r.output)).toEqual(direct)
  })

  it('budget calculation is deterministic for the same inputs', () => {
    const a = runTokenCountTool({ action: 'budget', used: 100, total: 400 })
    const b = runTokenCountTool({ action: 'budget', used: 100, total: 400 })
    expect(a).toEqual(b)
  })
})
