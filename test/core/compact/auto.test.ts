// test/core/compact/auto.test.ts
import { describe, it, expect, vi } from 'vitest'
import { shouldAutoCompact, maybeAutoCompact } from '../../../src/core/compact/auto'
import { createSession } from '../../../src/core/session/session'
import type { LLMProvider, ProviderEvent } from '../../../src/core/provider/types'
import type { AutoCompactOpts } from '../../../src/core/compact/auto'

function stubProvider(text = 'SUMMARY'): LLMProvider {
  return {
    id: 'p', format: 'openai',
    async *stream(): AsyncIterable<ProviderEvent> {
      yield { type: 'text_delta', text }
      yield { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 10, outputTokens: 20 } }
    },
    async listRemoteModels() { return [] },
  } as LLMProvider
}

function opts(override: Partial<AutoCompactOpts> = {}): AutoCompactOpts {
  return {
    provider: stubProvider(),
    model: 'm',
    autoThreshold: 0.8,
    contextWindow: 1000,
    ...override,
  }
}

describe('shouldAutoCompact', () => {
  it('returns false when total tokens are below threshold', () => {
    const s = createSession({ providerId: 'p', model: 'm' })
    s.totalUsage = { inputTokens: 400, outputTokens: 399 } // 799 < 800 (1000 * 0.8)
    expect(shouldAutoCompact(s, opts())).toBe(false)
  })

  it('returns true when total tokens exceed threshold', () => {
    const s = createSession({ providerId: 'p', model: 'm' })
    s.totalUsage = { inputTokens: 500, outputTokens: 400 } // 900 > 800 (1000 * 0.8)
    expect(shouldAutoCompact(s, opts())).toBe(true)
  })
})

describe('maybeAutoCompact', () => {
  it('returns compacted:false and does not call provider when below threshold', async () => {
    const s = createSession({ providerId: 'p', model: 'm' })
    s.totalUsage = { inputTokens: 300, outputTokens: 300 } // 600 < 800
    const provider = stubProvider()
    const streamSpy = vi.spyOn(provider, 'stream')
    const result = await maybeAutoCompact(s, opts({ provider }))
    expect(result.compacted).toBe(false)
    expect(result.before).toBe(600)
    expect(result.after).toBe(600)
    expect(streamSpy).not.toHaveBeenCalled()
  })

  it('calls provider stream and returns compacted:true when above threshold', async () => {
    const s = createSession({ providerId: 'p', model: 'm' })
    // Populate enough turns so compactSession doesn't no-op
    for (let i = 0; i < 6; i++) {
      s.messages.push({ role: 'user', id: `u${i}`, ts: i, content: [{ type: 'text', text: `u${i}` }] })
      s.messages.push({ role: 'assistant', id: `a${i}`, ts: i, content: [{ type: 'text', text: `a${i}` }] })
    }
    s.totalUsage = { inputTokens: 500, outputTokens: 400 } // 900 > 800
    const provider = stubProvider()
    const streamSpy = vi.spyOn(provider, 'stream')
    const result = await maybeAutoCompact(s, opts({ provider }))
    expect(result.compacted).toBe(true)
    expect(result.before).toBe(900)
    expect(streamSpy).toHaveBeenCalled()
  })
})
