import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'node:fs'; import * as os from 'node:os'; import * as path from 'node:path'
import { HarnessStateMachine } from '../../src/core/harness/state'
import { createEventBus } from '../../src/core/events/bus'
import { ensureNukaLayout } from '../../src/core/paths'
import type { HarnessEvent } from '../../src/core/events/types'

describe('phase14d e2e: feature profile through stages', () => {
  let home: string
  beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-14d-')); ensureNukaLayout(home) })

  it('walks brainstorm → spec → plan → search → implement → review → recap', async () => {
    const bus = createEventBus()
    const events: HarnessEvent[] = []
    bus.subscribe<HarnessEvent>('harness', e => events.push(e))
    const hsm = new HarnessStateMachine({ sessionId: 's1', bus, home, mode: 'deep' })
    await hsm.start('add a new login feature', { runFork: async () => ({ text: 'feature' }) })

    for (const stage of ['brainstorm', 'spec', 'plan', 'search'] as const) {
      await hsm.transition(stage)
      hsm.recordPrimitive('sequentialThinking')
      hsm.recordPrimitive('searchAndVerify')
      hsm.recordPrimitive('askUser')
    }
    await hsm.transition('implement')
    await hsm.transition('review')
    await hsm.transition('recap')

    const stages = events.filter(e => e.type === 'harness.stage.enter').map(e => e.stage)
    expect(stages).toEqual(['brainstorm', 'spec', 'plan', 'search', 'implement', 'review', 'recap'])
    expect(fs.existsSync(hsm.snapshot().scratchpadPath)).toBe(true)
  })

  it('refuses implement for explore profile', async () => {
    const bus = createEventBus()
    const hsm = new HarnessStateMachine({ sessionId: 's2', bus, home, mode: 'deep' })
    await hsm.start('explore the registry', { runFork: async () => ({ text: 'explore' }) })
    await hsm.transition('search')
    await expect(hsm.transition('implement')).rejects.toThrow(/forbidden/)
  })

  it('fast mode allows brainstorm → search', async () => {
    const bus = createEventBus()
    const hsm = new HarnessStateMachine({ sessionId: 's3', bus, home, mode: 'fast' })
    await hsm.start('add x', { runFork: async () => ({ text: 'feature' }) })
    await hsm.transition('search')                  // no brainstorm needed in fast mode
    expect(hsm.snapshot().currentStage).toBe('search')
  })
})
