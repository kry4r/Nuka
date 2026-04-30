// test/tui/Monitor/rollupTokens.test.ts
import { describe, it, expect } from 'vitest'
import { rollupTokens } from '../../../src/tui/Monitor/rollupTokens'

describe('rollupTokens', () => {
  it('accumulates per-agent input/output tokens', () => {
    const r = rollupTokens([
      { agentName: 'alice', inputTokens: 100, outputTokens: 50 },
      { agentName: 'alice', inputTokens: 200, outputTokens: 80 },
      { agentName: 'bob', inputTokens: 50, outputTokens: 25 },
    ])
    expect(r.alice.inputTokens).toBe(200)        // latest input wins
    expect(r.alice.outputTokens).toBe(130)
    expect(r.bob.inputTokens).toBe(50)
  })
})
