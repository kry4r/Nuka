import { describe, it, expect } from 'vitest'
import { reduceMessages } from '../../../../src/core/recap/fields/messages'

describe('reduceMessages', () => {
  it('takes top 10 by importance from 25 messages', () => {
    const records = Array.from({ length: 25 }, (_, i) => ({
      topic: 'message' as const,
      t: i * 1000,
      payload: {
        type: 'message.sent',
        envelope: {
          id: `m${i}`,
          from: 'lead',
          to: 'alice',
          summary: `msg ${i}`,
          message: 'body',
          sentAt: i * 1000,
        },
      },
    }))
    const r = reduceMessages(records)
    expect(r.length).toBe(10)
  })

  it('prioritizes broadcast messages (*)', () => {
    const r = reduceMessages([
      { topic: 'message', t: 100, payload: { type: 'message.sent', envelope: { id: 'b1', from: 'lead', to: '*', summary: 'broadcast', message: 'all', sentAt: 100 } } },
      { topic: 'message', t: 200, payload: { type: 'message.sent', envelope: { id: 'u1', from: 'a', to: 'b', summary: 'unicast', message: 'hi', sentAt: 200 } } },
    ])
    expect(r[0]!.id).toBe('b1')
  })

  it('returns empty for no message events', () => {
    const r = reduceMessages([
      { topic: 'task', t: 0, payload: { type: 'task.created', task: { id: 't1' } } },
    ])
    expect(r).toEqual([])
  })
})
