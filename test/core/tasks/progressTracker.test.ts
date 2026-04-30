import { describe, it, expect, beforeEach } from 'vitest'
import { ProgressTracker } from '../../../src/core/tasks/progressTracker'
import { createEventBus } from '../../../src/core/events/bus'
import type { TaskEvent } from '../../../src/core/events/types'

describe('ProgressTracker', () => {
  let bus: ReturnType<typeof createEventBus>
  let evts: TaskEvent[]
  beforeEach(() => {
    bus = createEventBus()
    evts = []
    bus.subscribe<TaskEvent>('task', e => evts.push(e))
  })

  it('caps recentActivities at 5', () => {
    const t = new ProgressTracker('t1', bus)
    for (let i = 0; i < 10; i++) {
      t.onToolStart(`tool-${i}`, {}, `Action ${i}`)
    }
    expect(t.snapshot().recentActivities.length).toBe(5)
    expect(t.snapshot().recentActivities.map(a => a.toolName)).toEqual([
      'tool-5','tool-6','tool-7','tool-8','tool-9',
    ])
  })

  it('collapses consecutive Read activities', () => {
    const t = new ProgressTracker('t2', bus)
    t.onToolStart('Read', { file: 'a.ts' }, 'Reading a.ts')
    t.onToolStart('Read', { file: 'b.ts' }, 'Reading b.ts')
    t.onToolStart('Read', { file: 'c.ts' }, 'Reading c.ts')
    const snap = t.snapshot()
    expect(snap.recentActivities.length).toBe(1)
    expect(snap.recentActivities[0]!.activityDescription).toMatch(/Reading 3 files/)
  })

  it('input tokens use latest, output tokens accumulate', () => {
    const t = new ProgressTracker('t3', bus)
    t.onUsage({ inputTokens: 100, outputTokens: 50 })
    t.onUsage({ inputTokens: 200, outputTokens: 80 })
    t.onUsage({ inputTokens: 300, outputTokens: 30 })
    const snap = t.snapshot()
    expect(snap.latestInputTokens).toBe(300)
    expect(snap.cumulativeOutputTokens).toBe(160)
    expect(snap.toolUseCount).toBe(0)
  })

  it('emits task.progress on snapshot()', () => {
    const t = new ProgressTracker('t4', bus)
    t.onToolStart('Bash', { command: 'ls' })
    t.snapshot()
    const prog = evts.find(e => e.type === 'task.progress')
    expect(prog).toBeTruthy()
    expect((prog as { id: string }).id).toBe('t4')
  })
})
