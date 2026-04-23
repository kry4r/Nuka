// test/core/session/telemetry.test.ts
import { describe, it, expect } from 'vitest'
import { computeCost, addUsage } from '../../../src/core/session/telemetry'
import type { ProviderConfig } from '../../../src/core/config/schema'

const provider: ProviderConfig = {
  id: 'p', name: 'x', format: 'openai', baseUrl: 'https://x', models: ['m1'],
  pricing: { m1: { input: 3, output: 15 } },
}

describe('telemetry', () => {
  it('addUsage accumulates input/output tokens', () => {
    const acc = { inputTokens: 10, outputTokens: 5 }
    const next = addUsage(acc, { inputTokens: 2, outputTokens: 3 })
    expect(next).toEqual({ inputTokens: 12, outputTokens: 8 })
  })

  it('computeCost uses the provider pricing table keyed by model', () => {
    const cost = computeCost(
      provider,
      'm1',
      { inputTokens: 1_000_000, outputTokens: 500_000 },
    )
    // 3.00 * 1 + 15.00 * 0.5 = 10.5
    expect(cost).toBeCloseTo(10.5, 2)
  })

  it('computeCost returns 0 when pricing is missing', () => {
    expect(
      computeCost(
        { ...provider, pricing: undefined },
        'm1',
        { inputTokens: 1000, outputTokens: 1000 },
      ),
    ).toBe(0)
  })
})
