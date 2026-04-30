import { describe, it, expect, beforeEach } from 'vitest'
import { createEventBus } from '../../../src/core/events/bus'
import type { TaskEvent } from '../../../src/core/events/types'

describe('EventBus', () => {
  let bus: ReturnType<typeof createEventBus>
  beforeEach(() => { bus = createEventBus({ ringSize: 8 }) })

  it('delivers emitted events to subscribers of the same topic', () => {
    const seen: TaskEvent[] = []
    bus.subscribe('task', (e: TaskEvent) => seen.push(e))
    const ev: TaskEvent = { type: 'task.evicted', id: 'abc' }
    bus.emit('task', ev)
    expect(seen).toEqual([ev])
  })

  it('does not deliver to subscribers of a different topic', () => {
    let count = 0
    bus.subscribe('agent', () => { count++ })
    bus.emit('task', { type: 'task.evicted', id: 'x' })
    expect(count).toBe(0)
  })

  it('respects an optional filter predicate', () => {
    const seen: TaskEvent[] = []
    bus.subscribe<TaskEvent>(
      'task',
      e => seen.push(e),
      e => e.type === 'task.evicted',
    )
    bus.emit('task', { type: 'task.created', task: {} as never })
    bus.emit('task', { type: 'task.evicted', id: 'y' })
    expect(seen.map(e => e.type)).toEqual(['task.evicted'])
  })

  it('replay returns last N entries of a topic, newest last', () => {
    for (let i = 0; i < 5; i++) {
      bus.emit('task', { type: 'task.evicted', id: `id-${i}` })
    }
    const last3 = bus.replay<TaskEvent>('task', 3)
    expect(last3.map(e => (e as { id: string }).id)).toEqual(['id-2', 'id-3', 'id-4'])
  })

  it('ring buffer is bounded by ringSize', () => {
    for (let i = 0; i < 20; i++) {
      bus.emit('task', { type: 'task.evicted', id: `${i}` })
    }
    const all = bus.replay<TaskEvent>('task', 100)
    expect(all.length).toBe(8)
    expect((all[0] as { id: string }).id).toBe('12')
    expect((all[7] as { id: string }).id).toBe('19')
  })

  it('unsubscribe stops further delivery', () => {
    let n = 0
    const off = bus.subscribe('task', () => { n++ })
    bus.emit('task', { type: 'task.evicted', id: '1' })
    off()
    bus.emit('task', { type: 'task.evicted', id: '2' })
    expect(n).toBe(1)
  })
})
