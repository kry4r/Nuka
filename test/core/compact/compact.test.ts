// test/core/compact/compact.test.ts
import { describe, it, expect } from 'vitest'
import { compactSession, COMPACT_SUMMARY_MARKER } from '../../../src/core/compact/compact'
import { createSession } from '../../../src/core/session/session'
import type { LLMProvider, ProviderEvent } from '../../../src/core/provider/types'

function stub(text: string): LLMProvider {
  return {
    id: 'p', format: 'openai',
    async *stream(): AsyncIterable<ProviderEvent> {
      yield { type: 'text_delta', text }
      yield {
        type: 'message_stop',
        stopReason: 'end_turn',
        usage: { inputTokens: 10, outputTokens: 20 },
      }
    },
    async listRemoteModels() { return [] },
  } as LLMProvider
}

describe('compactSession', () => {
  it('replaces older messages with a single compact summary, preserves keepTurns most recent', async () => {
    const s = createSession({ providerId: 'p', model: 'm' })
    for (let i = 0; i < 6; i++) {
      s.messages.push({ role: 'user', id: `u${i}`, ts: i, content: [{ type: 'text', text: `u${i}` }] })
      s.messages.push({ role: 'assistant', id: `a${i}`, ts: i, content: [{ type: 'text', text: `a${i}` }] })
    }
    expect(s.messages).toHaveLength(12)

    const before = s.messages.slice(-6) // last 3 turns
    await compactSession(s, { provider: stub('SUMMARY'), model: 'm', keepTurns: 3 })

    // 1 summary + last 6 messages = 7
    expect(s.messages).toHaveLength(7)
    const first = s.messages[0]
    expect(first.role).toBe('assistant')
    if (first.role === 'assistant') {
      const text = first.content.map((b: any) => b.text ?? '').join('')
      expect(text).toContain(COMPACT_SUMMARY_MARKER)
      expect(text).toContain('SUMMARY')
    }
    expect(s.messages.slice(1)).toEqual(before)
  })

  it('is a no-op when message count is already within the keep window', async () => {
    const s = createSession({ providerId: 'p', model: 'm' })
    s.messages.push({ role: 'user', id: 'u', ts: 1, content: [{ type: 'text', text: 'hi' }] })
    const before = s.messages.length
    await compactSession(s, { provider: stub('X'), model: 'm', keepTurns: 3 })
    expect(s.messages.length).toBe(before)
  })
})
