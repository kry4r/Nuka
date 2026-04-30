import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { TaskManager } from '../../src/core/tasks/manager'
import { TeamRegistry } from '../../src/core/teams/registry'
import { MessageRouter } from '../../src/core/messaging/router'
import { InProcessBackend } from '../../src/core/messaging/inProcessBackend'
import { ProgressTracker } from '../../src/core/tasks/progressTracker'
import { createEventBus } from '../../src/core/events/bus'
import { ensureNukaLayout } from '../../src/core/paths'
import type { TaskEvent, MessageEvent } from '../../src/core/events/types'
import type { MessageEnvelope } from '../../src/core/messaging/types'

describe('phase14 foundation end-to-end', () => {
  let home: string
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-foundation-'))
    ensureNukaLayout(home)
  })

  it('Team → MessageRouter → ProgressTracker → EventBus flow', async () => {
    const bus = createEventBus()
    const taskEvents: TaskEvent[] = []
    const messageEvents: MessageEvent[] = []
    bus.subscribe<TaskEvent>('task', (e: TaskEvent) => taskEvents.push(e))
    bus.subscribe<MessageEvent>('message', (e: MessageEvent) => messageEvents.push(e))

    // 1. Create a team.
    const teams = new TeamRegistry({ home })
    const team = await teams.create('demo', 'integration test')

    // 2. Register a fake teammate task — direct map insert
    //    (run-teammate runner is stubbed until phase14a).
    const mgr = new TaskManager({ home, bus })
    const fakeTask = {
      id: 'fake-1',
      kind: 'in_process_teammate' as const,
      description: 'fake',
      state: 'idle' as const,
      outputFile: path.join(home, '.nuka', 'tasks', 'fake-1.log'),
      teamName: 'demo',
      agentName: 'alice',
      spec: {
        kind: 'in_process_teammate' as const,
        description: 'fake',
        teamName: 'demo',
        agentName: 'alice',
        agentDef: { name: 'alice', description: 'd', maxTurns: 5, pluginName: 'core', allowedTools: [], deniedTools: [], systemPrompt: 'x' } as never,
        initialMessage: 'hi',
        longRunning: true,
      },
    }
    ;(mgr as unknown as { tasks: Map<string, unknown> }).tasks.set('fake-1', fakeTask)
    await teams.addMember('demo', { agentName: 'alice', agentDefRef: 'core:alice', spawnedAt: Date.now(), taskId: 'fake-1' })

    // 3. Set up a message router with in-process backend; subscribe alice.
    const backend = new InProcessBackend()
    const router = new MessageRouter({ backends: [backend], bus })
    const aliceInbox: MessageEnvelope[] = []
    backend.subscribe('team:demo/alice', (e: MessageEnvelope) => aliceInbox.push(e))

    // 4. Send a message to alice and verify delivery + bus events.
    const env: MessageEnvelope = {
      id: '01ABC', from: 'team:demo/lead', to: 'team:demo/alice',
      summary: 'kickoff', message: 'do the thing', sentAt: Date.now(),
    }
    expect(await router.send(env)).toBe(true)
    expect(aliceInbox.length).toBe(1)
    expect(messageEvents.map(e => e.type)).toEqual(['message.sent', 'message.delivered'])

    // 5. Run a tracker on the fake task, push usage + activity, snapshot.
    const tracker = new ProgressTracker('fake-1', bus)
    tracker.onToolStart('Read', { file: 'foo.ts' }, 'Reading foo.ts')
    tracker.onUsage({ inputTokens: 100, outputTokens: 50 })
    const snap = tracker.snapshot()
    mgr.setProgress('fake-1', snap)

    // 6. Verify task.progress fired.
    const prog = taskEvents.find((e: TaskEvent) => e.type === 'task.progress')
    expect(prog).toBeTruthy()
    expect((prog as { id: string }).id).toBe('fake-1')

    // 7. Verify team registry sees the member.
    expect(teams.find('demo')!.members.length).toBe(1)
    expect(team.taskListId).toBeTruthy()
  })
})
