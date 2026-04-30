import { describe, it, expect, vi } from 'vitest'
import { classifyTaskProfile } from '../../../src/core/harness/classifier'

describe('classifyTaskProfile', () => {
  it('returns the profile token', async () => {
    const fakeFork = vi.fn().mockResolvedValue({ text: 'feature' })
    const p = await classifyTaskProfile({ userMessage: 'add login', runFork: fakeFork })
    expect(p).toBe('feature')
  })
  it('falls back to feature on unknown token after retry', async () => {
    const fakeFork = vi.fn().mockResolvedValue({ text: 'unknown' })
    const p = await classifyTaskProfile({ userMessage: 'x', runFork: fakeFork })
    expect(p).toBe('feature')
    expect(fakeFork).toHaveBeenCalledTimes(2)
  })
})
