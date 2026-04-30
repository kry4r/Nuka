import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'node:fs'; import * as os from 'node:os'; import * as path from 'node:path'
import { runTeammate } from '../../../src/core/tasks/run-teammate'
import { createEventBus } from '../../../src/core/events/bus'
import { InProcessBackend } from '../../../src/core/messaging/inProcessBackend'
import { MessageRouter } from '../../../src/core/messaging/router'

describe('run-teammate', () => {
  let home: string
  beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-rt-')) })

  it('boots, processes initialMessage, then goes idle', async () => {
    const bus = createEventBus()
    const backend = new InProcessBackend()
    const router = new MessageRouter({ backends: [backend], bus })
    let states: string[] = []
    bus.subscribe('task', (e: any) => { if (e.type === 'task.state') states.push(e.to) })

    const fakeAgentLoop = async (_session: unknown, _msg: string) => {
      // one turn, one assistant response — uses camelCase TokenUsage
      return { text: 'done', usage: { inputTokens: 10, outputTokens: 5 } }
    }

    const task = {
      id: 't1', kind: 'in_process_teammate' as const, description: 'd', state: 'pending' as const,
      outputFile: '', spec: {
        kind: 'in_process_teammate' as const, description: '', teamName: 'demo', agentName: 'alice',
        agentDef: { name: 'alice', description: 'a', maxTurns: 5, pluginName: 'core', allowedTools: [], deniedTools: [], systemPrompt: 'x' } as never,
        initialMessage: 'do thing', longRunning: true,
      },
    } as never

    const ctrl = new AbortController()
    const promise = runTeammate(task, ctrl.signal, {
      bus, router,
      providerResolver: { resolve: () => null } as never,
      runOneTurn: fakeAgentLoop as never,
      home,
      summarizerInterval: 1_000_000,         // disabled for this test
    })
    // Let it process the initial message and go idle
    await new Promise(res => setTimeout(res, 100))
    expect(states).toContain('idle')
    ctrl.abort()
    await promise
  })

  it('handles shutdown_request envelope', async () => {
    const bus = createEventBus()
    const backend = new InProcessBackend()
    const router = new MessageRouter({ backends: [backend], bus })
    const fakeAgentLoop = async () => ({ text: 'k', usage: { inputTokens: 0, outputTokens: 0 } })
    const task = {
      id: 't2', kind: 'in_process_teammate' as const, description: '', state: 'pending' as const,
      outputFile: '', spec: { kind: 'in_process_teammate' as const, description: '', teamName: 'demo', agentName: 'bob', agentDef: { name: 'bob', description: 'b', maxTurns: 5, pluginName: 'core', allowedTools: [], deniedTools: [], systemPrompt: 'x' } as never, initialMessage: 'go', longRunning: true },
    } as never
    const ctrl = new AbortController()
    const promise = runTeammate(task, ctrl.signal, { bus, router, providerResolver: { resolve: () => null } as never, runOneTurn: fakeAgentLoop as never, home, summarizerInterval: 1_000_000 })
    await new Promise(res => setTimeout(res, 50))
    await router.send({ id: 'x', from: 'lead', to: 'team:demo/bob', summary: 'shutdown', message: { type: 'shutdown_request', request_id: 'r1' }, sentAt: 0 })
    await promise
  })

  it('emits shutdown_request envelope when manager flips task state to shutdown_requested', async () => {
    const bus = createEventBus()
    const backend = new InProcessBackend()
    const router = new MessageRouter({ backends: [backend], bus })
    const fakeAgentLoop = async () => ({ text: 'k', usage: { inputTokens: 0, outputTokens: 0 } })
    const task = {
      id: 't3', kind: 'in_process_teammate' as const, description: '', state: 'pending' as const,
      outputFile: '', spec: {
        kind: 'in_process_teammate' as const, description: '', teamName: 'demo', agentName: 'carol',
        agentDef: { name: 'carol', description: 'c', maxTurns: 5, pluginName: 'core', allowedTools: [], deniedTools: [], systemPrompt: 'x' } as never,
        initialMessage: 'go', longRunning: true,
      },
    } as never

    // Track envelopes sent to carol's address
    const sent: string[] = []
    router.inbox('team:demo/carol').subscribe((env: any) => {
      if (env.message?.type) sent.push(env.message.type)
    })

    const ctrl = new AbortController()
    const promise = runTeammate(task, ctrl.signal, {
      bus, router,
      providerResolver: { resolve: () => null } as never,
      runOneTurn: fakeAgentLoop as never,
      home,
      summarizerInterval: 1_000_000,
    })

    // Let it process initialMessage and go idle
    await new Promise(res => setTimeout(res, 50))

    // Manager emits task.state → shutdown_requested (simulating requestShutdown)
    bus.emit('task', { type: 'task.state', id: 't3', from: 'running', to: 'shutdown_requested' })

    await promise
    expect(sent).toContain('shutdown_request')
  })
})
