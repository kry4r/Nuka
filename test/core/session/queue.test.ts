// test/core/session/queue.test.ts
import { describe, it, expect } from 'vitest'
import { MessageQueue } from '../../../src/core/session/queue'

describe('MessageQueue', () => {
  it('reports hasPending and drains fifo', () => {
    const q = new MessageQueue()
    expect(q.hasPending()).toBe(false)
    q.push('a'); q.push('b')
    expect(q.hasPending()).toBe(true)
    expect(q.drain()).toEqual(['a', 'b'])
    expect(q.hasPending()).toBe(false)
  })

  it('drain empties the queue', () => {
    const q = new MessageQueue()
    q.push('x')
    q.drain()
    expect(q.drain()).toEqual([])
  })

  it('size reports pending count', () => {
    const q = new MessageQueue()
    q.push('a'); q.push('b'); q.push('c')
    expect(q.size()).toBe(3)
  })
})
