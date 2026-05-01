import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { ulid } from 'ulid'
import { A2ARouter } from '../../../src/core/coordination/a2aRouter'
import { TaskGraph } from '../../../src/core/coordination/taskGraph'
import { createEventBus, type EventBus } from '../../../src/core/events/bus'
import type { HarnessEvent } from '../../../src/core/events/types'

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

describe('A2ARouter', () => {
  let bus: EventBus
  let send: ReturnType<typeof vi.fn>
  let tmp: string

  beforeEach(() => {
    bus = createEventBus()
    send = vi.fn().mockResolvedValue(true)
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-a2a-'))
  })

  const makeGraph = (): TaskGraph => {
    const g = new TaskGraph({ rootMessage: 'r', difficulty: 'hell' })
    g.add({ id: 'a', title: 'A', profile: 'feature', testStrategy: 'tdd', agentId: 'agent1', status: 'listening', dependsOn: [], contextFor: ['b'], result: { summary: 'ok', artifacts: [] } })
    g.add({ id: 'b', title: 'B', profile: 'feature', testStrategy: 'tdd', agentId: null, status: 'pending', dependsOn: ['a'], contextFor: [], result: null })
    return g
  }

  it('订阅命中 task.started → emit a2a.dispatched + send_message', async () => {
    const graph = makeGraph()
    const router = new A2ARouter({ bus, graph, sessionId: 's1', send, subsPath: path.join(tmp, 'subs.json') })
    router.subscribe({
      subscriberAgentId: 'agent1',
      ownsTaskId: 'a',
      triggersOn: ['b'],
      triggerCount: 0,
      lifecycle: 'until-correlated-tasks-done',
    })
    const events: HarnessEvent[] = []
    bus.subscribe<HarnessEvent>('harness', (e) => events.push(e))
    bus.emit('harness', { type: 'coordination.task.started', sessionId: 's1', taskId: 'b', agentId: 'agent2' })
    await flush()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].from).toBe('agent1')
    expect(send.mock.calls[0][0].to).toBe('agent2')
    expect(events.find((e) => e.type === 'coordination.a2a.dispatched')).toBeTruthy()
  })

  it('triggerCount 上限 3', async () => {
    const graph = makeGraph()
    const router = new A2ARouter({ bus, graph, sessionId: 's1', send, subsPath: path.join(tmp, 'subs.json') })
    router.subscribe({
      subscriberAgentId: 'agent1',
      ownsTaskId: 'a',
      triggersOn: ['b'],
      triggerCount: 0,
      lifecycle: 'until-session-end',
    })
    for (let i = 0; i < 5; i++) {
      bus.emit('harness', { type: 'coordination.task.started', sessionId: 's1', taskId: 'b', agentId: 'agent2' })
      await flush()
    }
    expect(send.mock.calls.length).toBe(3)
  })

  it('lifecycle until-correlated-tasks-done 在所有 triggersOn 完成后 unsubscribe', async () => {
    const graph = makeGraph()
    const router = new A2ARouter({ bus, graph, sessionId: 's1', send, subsPath: path.join(tmp, 'subs.json') })
    router.subscribe({
      subscriberAgentId: 'agent1',
      ownsTaskId: 'a',
      triggersOn: ['b'],
      triggerCount: 0,
      lifecycle: 'until-correlated-tasks-done',
    })
    expect(router.activeCount()).toBe(1)
    bus.emit('harness', { type: 'coordination.task.completed', sessionId: 's1', taskId: 'b', agentId: 'agent2' })
    await flush()
    expect(router.activeCount()).toBe(0)
  })

  it('忽略其他 sessionId 的事件', async () => {
    const graph = makeGraph()
    const router = new A2ARouter({ bus, graph, sessionId: 's1', send, subsPath: path.join(tmp, 'subs.json') })
    router.subscribe({
      subscriberAgentId: 'agent1',
      ownsTaskId: 'a',
      triggersOn: ['b'],
      triggerCount: 0,
      lifecycle: 'until-session-end',
    })
    bus.emit('harness', { type: 'coordination.task.started', sessionId: 'OTHER', taskId: 'b', agentId: 'agent2' })
    await flush()
    expect(send).not.toHaveBeenCalled()
  })

  it('订阅持久化：subscribe 写文件，loadSubs 恢复', () => {
    const graph = makeGraph()
    const subsPath = path.join(tmp, 'subs.json')
    const router1 = new A2ARouter({ bus, graph, sessionId: 's1', send, subsPath })
    router1.subscribe({
      subscriberAgentId: 'agent1',
      ownsTaskId: 'a',
      triggersOn: ['b'],
      triggerCount: 0,
      lifecycle: 'until-session-end',
    })
    const onDisk = JSON.parse(fs.readFileSync(subsPath, 'utf8'))
    expect(onDisk).toHaveLength(1)

    const router2 = new A2ARouter({ bus, graph, sessionId: 's1', send, subsPath })
    router2.loadSubs()
    expect(router2.activeCount()).toBe(1)
  })
})

void ulid // keep import live for ulid availability test if needed later
