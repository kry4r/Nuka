import { describe, it, expect, beforeEach, beforeAll } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { HarnessStateMachine } from '../../../src/core/harness/state'
import { createEventBus } from '../../../src/core/events/bus'
import { ensureNukaLayout } from '../../../src/core/paths'
import { initMatrix } from '../../../src/core/harness/matrix'

describe('HarnessStateMachine', () => {
  let home: string
  let bus: ReturnType<typeof createEventBus>

  beforeAll(() => initMatrix(path.join(process.cwd(), 'assets/harness/profiles.yaml')))

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-hsm-'))
    ensureNukaLayout(home)
    bus = createEventBus()
  })

  it('start() returns Triage with default difficulty/testStrategy', async () => {
    const hsm = new HarnessStateMachine({ sessionId: 's1', bus, home, mode: 'deep' })
    let evtCount = 0
    bus.subscribe('harness', () => evtCount++)
    const triage = await hsm.start('add new login flow', { runFork: async () => ({ text: 'feature' }) })
    expect(triage.profile).toBe('feature')
    expect(triage.difficulty).toBe('medium')
    expect(triage.testStrategy).toBe('tdd')
    const snap = hsm.snapshot()
    expect(snap.triage?.profile).toBe('feature')
  })

  it('canTransition gates against profile×difficulty (investigate forbids implement)', async () => {
    const hsm = new HarnessStateMachine({ sessionId: 's2', bus, home, mode: 'deep' })
    hsm.setTriage({ profile: 'investigate', difficulty: 'medium', testStrategy: 'tdd', reasoning: 'manual', userConfirmed: true })
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

  it('snapshot includes taskGraphPath', async () => {
    const hsm = new HarnessStateMachine({ sessionId: 's4', bus, home, mode: 'deep' })
    expect(hsm.snapshot().taskGraphPath).toContain('coordination')
    expect(hsm.snapshot().taskGraphPath).toContain('s4')
  })
})
