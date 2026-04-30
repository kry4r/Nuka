import { describe, it, expect } from 'vitest'
import { MessageRouter } from '../../../src/core/messaging/router'
import { InProcessBackend } from '../../../src/core/messaging/inProcessBackend'
import { createEventBus } from '../../../src/core/events/bus'
import type { MessageEnvelope } from '../../../src/core/messaging/types'
import type { MessageEvent } from '../../../src/core/events/types'

const env = (to: string, overrides: Partial<MessageEnvelope> = {}): MessageEnvelope => ({
  id: 'm', from: 'team:t/a', to, summary: 'hi', message: 'hi', sentAt: 1, ...overrides,
})

describe('MessageRouter', () => {
  it('routes through the in-process backend by default', async () => {
    const bus = createEventBus()
    const backend = new InProcessBackend()
    const r = new MessageRouter({ backends: [backend], bus })
    const got: MessageEnvelope[] = []
    backend.subscribe('team:t/b', (e: MessageEnvelope) => got.push(e))
    expect(await r.send(env('team:t/b'))).toBe(true)
    expect(got.length).toBe(1)
  })

  it('emits message.sent + message.delivered on success', async () => {
    const bus = createEventBus()
    const backend = new InProcessBackend()
    const r = new MessageRouter({ backends: [backend], bus })
    backend.subscribe('team:t/b', () => {})
    const seen: MessageEvent[] = []
    bus.subscribe<MessageEvent>('message', (e: MessageEvent) => seen.push(e))
    await r.send(env('team:t/b'))
    expect(seen.map(e => e.type)).toEqual(['message.sent', 'message.delivered'])
  })

  it('emits message.failed when no backend accepts', async () => {
    const bus = createEventBus()
    const r = new MessageRouter({ backends: [new InProcessBackend()], bus })
    const seen: MessageEvent[] = []
    bus.subscribe<MessageEvent>('message', (e: MessageEvent) => seen.push(e))
    expect(await r.send(env('team:t/nobody'))).toBe(false)
    expect(seen.some(e => e.type === 'message.failed')).toBe(true)
  })

  it('broadcast sends to every member of a team', async () => {
    const bus = createEventBus()
    const backend = new InProcessBackend()
    const r = new MessageRouter({ backends: [backend], bus })
    let aHits = 0, bHits = 0
    backend.subscribe('team:t/a', () => aHits++)
    backend.subscribe('team:t/b', () => bHits++)
    const n = await r.broadcast({
      teamName: 't',
      members: ['a', 'b'],
      base: { id: 'x', from: 'team:t/lead', summary: 'all', message: 'hello', sentAt: 0 },
    })
    expect(n).toBe(2)
    expect(aHits).toBe(1)
    expect(bHits).toBe(1)
  })
})
