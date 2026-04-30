import { describe, it, expect, vi } from 'vitest'
import { generateAwaySummary } from '../../../src/core/recap/awaySummary'

describe('generateAwaySummary', () => {
  it('calls runFork and returns trimmed text', async () => {
    const fakeFork = vi.fn().mockResolvedValue({ text: 'You were refactoring. Next: fix the type error.', usage: { inputTokens: 100, outputTokens: 30 }, modelUsed: 'test-model' })
    const result = await generateAwaySummary({
      messages: [],
      signal: new AbortController().signal,
      runFork: fakeFork,
    })
    expect(fakeFork).toHaveBeenCalledOnce()
    expect(result.text).toContain('refactoring')
    expect(result.tokensUsed).toBe(100)
    expect(result.modelUsed).toBe('test-model')
  })

  it('truncates text to 400 chars', async () => {
    const big = 'y'.repeat(800)
    const result = await generateAwaySummary({
      messages: [],
      signal: new AbortController().signal,
      runFork: async () => ({ text: big, usage: { inputTokens: 0, outputTokens: 0 } }),
    })
    expect(result.text.length).toBe(400)
  })
})
