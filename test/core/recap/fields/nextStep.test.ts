import { describe, it, expect, vi } from 'vitest'
import { reduceNextStep } from '../../../../src/core/recap/fields/nextStep'

describe('reduceNextStep', () => {
  it('calls runForkedAgent with constrained prompt and returns single paragraph', async () => {
    const fakeFork = vi.fn().mockResolvedValue({ text: 'Resume the impl stage by checking tests/foo.test.ts:42.' })
    const r = await reduceNextStep({ events: [], session: { messages: [] } as any, runFork: fakeFork })
    expect(r.length).toBeLessThan(500)
    expect(r).toContain('impl')
    expect(fakeFork).toHaveBeenCalledOnce()
  })

  it('truncates excess text to 500 chars', async () => {
    const big = 'x'.repeat(800)
    const r = await reduceNextStep({
      events: [],
      session: { messages: [] } as any,
      runFork: async () => ({ text: big }),
    })
    expect(r.length).toBe(500)
  })
})
