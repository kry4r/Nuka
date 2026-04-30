import { describe, it, expect } from 'vitest'
import { InProcessBackend } from '../../../src/core/messaging/inProcessBackend'
import type { MessageEnvelope } from '../../../src/core/messaging/types'

const env = (overrides: Partial<MessageEnvelope> = {}): MessageEnvelope => ({
  id: 'm1', from: 'team:t/a', to: 'team:t/b', summary: 'hi', message: 'hi', sentAt: 1, ...overrides,
})

describe('InProcessBackend', () => {
  it('delivers when recipient is subscribed', async () => {
    const b = new InProcessBackend()
    const got: MessageEnvelope[] = []
    b.subscribe('team:t/b', (e: MessageEnvelope) => got.push(e))
    const ok = await b.send(env())
    expect(ok).toBe(true)
    expect(got.length).toBe(1)
    expect(got[0]!.id).toBe('m1')
  })

  it('returns false when recipient is not subscribed', async () => {
    const b = new InProcessBackend()
    expect(await b.send(env({ to: 'team:t/nobody' }))).toBe(false)
  })

  it('unsubscribe stops further delivery', async () => {
    const b = new InProcessBackend()
    let n = 0
    const off = b.subscribe('team:t/b', () => { n++ })
    await b.send(env())
    off()
    await b.send(env())
    expect(n).toBe(1)
  })

  it('queues envelopes for an address with no live subscriber', async () => {
    const b = new InProcessBackend()
    // Note: send returns false because no live subscriber, but message must
    // still be available via pending()/drain() for the address.
    const ok = await b.send(env({ to: 'team:t/offline' }))
    expect(ok).toBe(false)
    expect(b.pending('team:t/offline')).toBe(1)
    const drained = b.drain('team:t/offline')
    expect(drained.length).toBe(1)
    expect(drained[0]!.id).toBe('m1')
    expect(b.pending('team:t/offline')).toBe(0)
  })

  it('drain returns empty when address has no queue', () => {
    const b = new InProcessBackend()
    expect(b.drain('team:t/none')).toEqual([])
  })

  it('subscribing after queued messages flushes the queue to the new subscriber', async () => {
    const b = new InProcessBackend()
    await b.send(env({ to: 'team:t/late' }))
    const got: MessageEnvelope[] = []
    b.subscribe('team:t/late', (e: MessageEnvelope) => got.push(e))
    // Queued messages now delivered to live subscriber.
    expect(got.length).toBe(1)
    expect(b.pending('team:t/late')).toBe(0)
  })
})
