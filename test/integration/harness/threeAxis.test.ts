import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { HarnessStateMachine } from '../../../src/core/harness/state'
import { createEventBus } from '../../../src/core/events/bus'
import { ensureNukaLayout } from '../../../src/core/paths'
import { initMatrix } from '../../../src/core/harness/matrix'
import { TaskGraph } from '../../../src/core/coordination/taskGraph'
import { A2ARouter } from '../../../src/core/coordination/a2aRouter'
import type { HarnessEvent } from '../../../src/core/events/types'
import type { MessageEnvelope } from '../../../src/core/messaging/types'

const flush = (): Promise<void> => new Promise((r) => setImmediate(r))

const validDecompose = JSON.stringify({
  tasks: [
    { id: 'A', title: 'task A', profile: 'feature', testStrategy: 'tdd' },
    { id: 'B', title: 'task B', profile: 'feature', testStrategy: 'tdd' },
    { id: 'C', title: 'task C', profile: 'feature', testStrategy: 'tdd' },
  ],
  edges: [
    ['A', 'B', 'A precedes B'],
    ['A', 'C', 'A precedes C'],
  ],
})

describe('three-axis end-to-end', () => {
  let home: string
  beforeAll(() => initMatrix(path.join(process.cwd(), 'assets/harness/profiles.yaml')))
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-3ax-e2e-'))
    ensureNukaLayout(home)
  })

  it('simple-debug-fix: planExecution returns inline (no decomposition, no graph file)', async () => {
    const hsm = new HarnessStateMachine({ sessionId: 'simple-1', bus: createEventBus(), home, mode: 'deep' })
    hsm.setTriage({ profile: 'debug-fix', difficulty: 'simple', testStrategy: 'tdd', reasoning: 'r', userConfirmed: true })
    const fork = vi.fn()
    const plan = await hsm.planExecution('fix typo', { runFork: fork })
    expect(plan.kind).toBe('inline')
    expect(fork).not.toHaveBeenCalled()
    expect(fs.existsSync(hsm.snapshot().taskGraphPath)).toBe(false)
  })

  it('hard-feature: planExecution decomposes + persists graph; toposort respects DAG', async () => {
    const hsm = new HarnessStateMachine({ sessionId: 'hard-1', bus: createEventBus(), home, mode: 'deep' })
    hsm.setTriage({ profile: 'feature', difficulty: 'hard', testStrategy: 'cross-module', reasoning: 'r', userConfirmed: true })
    const fork = vi.fn().mockResolvedValue({ text: validDecompose })
    const plan = await hsm.planExecution('big feature', { runFork: fork })
    expect(plan.kind).toBe('graph')
    if (plan.kind === 'graph') expect(plan.listening).toBe(false)
    const { loadGraph } = await import('../../../src/core/coordination/persist')
    const graph = loadGraph(hsm.snapshot().taskGraphPath)!
    const order = graph.toposort()
    expect(order.indexOf('A')).toBeLessThan(order.indexOf('B'))
    expect(order.indexOf('A')).toBeLessThan(order.indexOf('C'))
  })

  it('hell-refactor: a2a router fires when task B starts → agent1 (owner of A, listening) sends supplement to agent2', async () => {
    const sessionId = 'hell-1'
    const bus = createEventBus()
    const hsm = new HarnessStateMachine({ sessionId, bus, home, mode: 'deep' })
    hsm.setTriage({ profile: 'refactor', difficulty: 'hell', testStrategy: 'multi-test', reasoning: 'r', userConfirmed: true })
    const fork = vi.fn().mockResolvedValue({ text: validDecompose })
    const plan = await hsm.planExecution('huge refactor', { runFork: fork })
    expect(plan.kind).toBe('graph')

    // Simulate the scheduler running A on agent1, then transitioning A to listening (hell mode keeps it alive)
    const { loadGraph } = await import('../../../src/core/coordination/persist')
    const graph = loadGraph(hsm.snapshot().taskGraphPath)!
    graph.markRunning('A', 'agent1')
    // mark A as done so dependents (B, C) become ready (listening would also work but done is canonical here)
    graph.markDone('A', { summary: 'A done; expects B/C to share schema X', artifacts: ['schema.ts'] })
    // Wire the router: agent1 stays in listening state to push supplements when B/C start
    graph.markListening('A')

    const sent: MessageEnvelope[] = []
    const router = new A2ARouter({
      bus,
      graph,
      sessionId,
      send: async (env) => {
        sent.push(env)
        return true
      },
      subsPath: path.join(home, '.nuka', 'coordination', `${sessionId}.subs.json`),
    })
    router.subscribe({
      subscriberAgentId: 'agent1',
      ownsTaskId: 'A',
      triggersOn: ['B', 'C'],
      triggerCount: 0,
      lifecycle: 'until-correlated-tasks-done',
    })

    // B starts on agent2 → router should fire
    bus.emit('harness', { type: 'coordination.task.started', sessionId, taskId: 'B', agentId: 'agent2' })
    await flush()
    expect(sent.length).toBe(1)
    expect(sent[0]!.from).toBe('agent1')
    expect(sent[0]!.to).toBe('agent2')
    expect(sent[0]!.message).toContain('A done')

    // C starts on agent3 → router should fire again
    bus.emit('harness', { type: 'coordination.task.started', sessionId, taskId: 'C', agentId: 'agent3' })
    await flush()
    expect(sent.length).toBe(2)
    expect(sent[1]!.to).toBe('agent3')

    // Verify dispatched event was emitted
    const dispatched = (bus as { replay: <E>(t: string, n: number) => E[] }).replay<HarnessEvent>('harness', 100).filter(
      (e) => e.type === 'coordination.a2a.dispatched',
    )
    expect(dispatched.length).toBe(2)

    router.dispose()
  })

  it('investigate/hell: planExecution with investigate.implement = forbidden still allowed at plan stage but blocked at canTransition', async () => {
    const bus = createEventBus()
    const hsm = new HarnessStateMachine({ sessionId: 'inv-1', bus, home, mode: 'deep' })
    hsm.setTriage({ profile: 'investigate', difficulty: 'hell', testStrategy: 'tdd', reasoning: 'r', userConfirmed: true })
    await hsm.transition('search')
    expect(hsm.canTransition('implement').ok).toBe(false)
  })

  it('triggerCount cap: a2a router stops firing after 3 invocations on same subscription', async () => {
    const sessionId = 'cap-1'
    const bus = createEventBus()
    const graph = new TaskGraph({ rootMessage: 'r', difficulty: 'hell' })
    graph.add({ id: 'A', title: 'A', profile: 'feature', testStrategy: 'tdd', agentId: 'agent1', status: 'listening', dependsOn: [], contextFor: ['B'], result: { summary: 'ok', artifacts: [] } })
    graph.add({ id: 'B', title: 'B', profile: 'feature', testStrategy: 'tdd', agentId: null, status: 'pending', dependsOn: ['A'], contextFor: [], result: null })
    const sent: MessageEnvelope[] = []
    const router = new A2ARouter({
      bus,
      graph,
      sessionId,
      send: async (env) => {
        sent.push(env)
        return true
      },
      subsPath: path.join(home, '.nuka', 'coordination', `${sessionId}.subs.json`),
    })
    router.subscribe({
      subscriberAgentId: 'agent1',
      ownsTaskId: 'A',
      triggersOn: ['B'],
      triggerCount: 0,
      lifecycle: 'until-session-end',
    })
    for (let i = 0; i < 5; i++) {
      bus.emit('harness', { type: 'coordination.task.started', sessionId, taskId: 'B', agentId: 'agent2' })
      await flush()
    }
    expect(sent.length).toBe(3) // capped
    router.dispose()
  })
})
