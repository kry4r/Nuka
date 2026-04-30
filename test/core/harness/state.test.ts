import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'node:fs'; import * as os from 'node:os'; import * as path from 'node:path'
import { HarnessStateMachine } from '../../../src/core/harness/state'
import { createEventBus } from '../../../src/core/events/bus'
import { ensureNukaLayout } from '../../../src/core/paths'

describe('HarnessStateMachine', () => {
  let home: string; let bus: ReturnType<typeof createEventBus>
  beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-hsm-')); ensureNukaLayout(home); bus = createEventBus() })

  it('start() sets profile and emits events', async () => {
    const hsm = new HarnessStateMachine({ sessionId: 's1', bus, home, mode: 'deep' })
    let evtCount = 0; bus.subscribe('harness', () => evtCount++)
    const profile = await hsm.start('add new login flow', { runFork: async () => ({ text: 'feature' }) })
    expect(profile).toBe('feature')
    expect(hsm.snapshot().taskProfile).toBe('feature')
  })

  it('canTransition gates against profile', async () => {
    const hsm = new HarnessStateMachine({ sessionId: 's2', bus, home, mode: 'deep' })
    await hsm.start('explore the registry', { runFork: async () => ({ text: 'explore' }) })
    await hsm.transition('search')
    expect(hsm.canTransition('implement').ok).toBe(false)
  })

  it('exit gate blocks if mandatory primitives unrecorded (brainstorm)', async () => {
    const hsm = new HarnessStateMachine({ sessionId: 's3', bus, home, mode: 'deep' })
    await hsm.start('add x', { runFork: async () => ({ text: 'feature' }) })
    await hsm.transition('brainstorm')
    const r = hsm.canExit('spec')
    expect(r.ok).toBe(false)
    hsm.recordPrimitive('sequentialThinking')
    hsm.recordPrimitive('searchAndVerify')
    hsm.recordPrimitive('askUser')
    expect(hsm.canExit('spec').ok).toBe(true)
  })
})
