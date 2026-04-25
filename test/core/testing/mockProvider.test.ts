// test/core/testing/mockProvider.test.ts
import { describe, it, expect } from 'vitest'
import { MockProvider } from '../../../src/core/testing/mockProvider'
import type { LLMRequest } from '../../../src/core/provider/types'

const fakeReq: LLMRequest = {
  model: 'm', messages: [], system: '', tools: [],
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const ev of it) out.push(ev)
  return out
}

describe('MockProvider', () => {
  it('implements LLMProvider with id/format defaults', () => {
    const p = new MockProvider()
    expect(p.id).toBe('mock')
    expect(p.format).toBe('anthropic')
  })

  it('streams scripted text deltas then a single message_stop with usage', async () => {
    const p = new MockProvider({
      responses: [{
        delta: [
          { type: 'text_delta', text: 'hi ' },
          { type: 'text_delta', text: 'there' },
        ],
        usage: { inputTokens: 7, outputTokens: 3 },
      }],
    })
    const events = await collect(p.stream(fakeReq, new AbortController().signal))
    expect(events).toHaveLength(3)
    expect(events[0]).toEqual({ type: 'text_delta', text: 'hi ' })
    expect(events[1]).toEqual({ type: 'text_delta', text: 'there' })
    expect(events[2]).toEqual({
      type: 'message_stop',
      stopReason: 'end_turn',
      usage: { inputTokens: 7, outputTokens: 3 },
    })
  })

  it('uses zero usage when none provided', async () => {
    const p = new MockProvider({ responses: [{ delta: [{ type: 'text_delta', text: 'x' }] }] })
    const events = await collect(p.stream(fakeReq, new AbortController().signal))
    const stop = events.find(e => e.type === 'message_stop')!
    expect(stop).toMatchObject({ usage: { inputTokens: 0, outputTokens: 0 } })
  })

  it('append() queues an additional scripted response', async () => {
    const p = new MockProvider({ responses: [{ delta: [{ type: 'text_delta', text: 'a' }] }] })
    p.append({ delta: [{ type: 'text_delta', text: 'b' }] })
    expect(p.remaining()).toBe(2)
    const sig = new AbortController().signal
    const first = await collect(p.stream(fakeReq, sig))
    const second = await collect(p.stream(fakeReq, sig))
    expect(first[0]).toMatchObject({ text: 'a' })
    expect(second[0]).toMatchObject({ text: 'b' })
    expect(p.remaining()).toBe(0)
  })

  it('throws when out of scripted responses', async () => {
    const p = new MockProvider()
    await expect(collect(p.stream(fakeReq, new AbortController().signal))).rejects.toThrow(/no scripted response/)
  })

  it('respects abort signal between deltas', async () => {
    const p = new MockProvider({
      responses: [{ delta: [{ type: 'text_delta', text: 'a' }, { type: 'text_delta', text: 'b' }] }],
    })
    const ac = new AbortController()
    const out: unknown[] = []
    for await (const ev of p.stream(fakeReq, ac.signal)) {
      out.push(ev)
      ac.abort()
    }
    // Yielded the first delta, then aborted before the second.
    expect(out).toHaveLength(1)
  })

  it('listRemoteModels returns []', async () => {
    expect(await new MockProvider().listRemoteModels()).toEqual([])
  })
})
