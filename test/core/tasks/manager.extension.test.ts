import { describe, it, expect, beforeEach } from 'vitest'
import { vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { TaskManager } from '../../../src/core/tasks/manager'
import { createEventBus } from '../../../src/core/events/bus'
import type { TaskEvent } from '../../../src/core/events/types'
import { readMeta } from '../../../src/core/tasks/meta'

describe('TaskManager extensions', () => {
  let home: string
  let bus: ReturnType<typeof createEventBus>
  let mgr: TaskManager
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-mgr-'))
    bus = createEventBus()
    mgr = new TaskManager({ home, bus })
  })

  it('emits task.created on enqueue', () => {
    const seen: TaskEvent[] = []
    bus.subscribe<TaskEvent>('task', (e: TaskEvent) => seen.push(e))
    mgr.enqueue({ kind: 'local_bash', description: 'd', command: 'echo', args: ['1'] })
    expect(seen[0]!.type).toBe('task.created')
  })

  it('setProgress emits task.progress', () => {
    const seen: TaskEvent[] = []
    bus.subscribe<TaskEvent>('task', (e: TaskEvent) => seen.push(e))
    const t = mgr.enqueue({ kind: 'local_bash', description: 'd', command: 'true' })
    mgr.setProgress(t.id, {
      toolUseCount: 2,
      latestInputTokens: 100,
      cumulativeOutputTokens: 50,
      recentActivities: [],
    })
    expect(seen.find((e: TaskEvent) => e.type === 'task.progress')).toBeTruthy()
  })

  it('resolveTeammate returns task id by qualified address', () => {
    type ManagerInternals = { tasks: Map<string, { id: string; agentName?: string; teamName?: string }> }
    const internals = mgr as unknown as ManagerInternals
    internals.tasks.set('id-1', { id: 'id-1', agentName: 'alice', teamName: 'demo' })
    expect(mgr.resolveTeammate('team:demo/alice')).toBe('id-1')
    expect(mgr.resolveTeammate('team:demo/nobody')).toBeUndefined()
  })

  it('subscribe routes through the bus when provided', () => {
    const seen: TaskEvent[] = []
    const off = mgr.subscribe('task', (e: TaskEvent) => seen.push(e))
    mgr.enqueue({ kind: 'local_bash', description: 'd', command: 'true' })
    off()
    expect(seen.length).toBeGreaterThan(0)
  })

  it('writes <id>.meta.json on terminal transition', async () => {
    const t = mgr.enqueue({ kind: 'local_bash', description: 'd', command: 'true' })
    await new Promise(res => setTimeout(res, 100))  // give the runner time
    const meta = readMeta(home, t.id)
    expect(meta?.id).toBe(t.id)
    expect(['completed', 'failed']).toContain(meta?.state)
  })

  it('requestShutdown timer is cleared when task transitions before fire', async () => {
    vi.useFakeTimers()
    try {
      const t = mgr.enqueue({ kind: 'local_bash', description: 'd', command: 'true' })
      await mgr.requestShutdown(t.id)
      // Manually transition to completed before timer fires.
      type ManagerInternals = { tasks: Map<string, { state: string }> }
      const internals = mgr as unknown as ManagerInternals
      const task = internals.tasks.get(t.id)!
      task.state = 'completed'
      // Advance past 30s — cancel should NOT fire (state is 'completed', not 'shutdown_requested').
      vi.advanceTimersByTime(31_000)
      expect(task.state).toBe('completed')
    } finally {
      vi.useRealTimers()
    }
  })
})
