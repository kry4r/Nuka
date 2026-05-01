import { describe, it, expect, beforeEach, beforeAll } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { HarnessStateMachine } from '../../src/core/harness/state'
import { createEventBus } from '../../src/core/events/bus'
import { ensureNukaLayout } from '../../src/core/paths'
import { initMatrix } from '../../src/core/harness/matrix'
import type { HarnessEvent } from '../../src/core/events/types'

describe('three-axis harness e2e', () => {
  let home: string

  beforeAll(() => initMatrix(path.join(process.cwd(), 'assets/harness/profiles.yaml')))

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-3ax-'))
    ensureNukaLayout(home)
  })

  it('feature/medium walks every stage, scratchpad gets written', async () => {
    const bus = createEventBus()
    const events: HarnessEvent[] = []
    bus.subscribe<HarnessEvent>('harness', (e) => events.push(e))
    const hsm = new HarnessStateMachine({ sessionId: 's1', bus, home, mode: 'deep' })
    hsm.setTriage({
      profile: 'feature',
      difficulty: 'medium',
      testStrategy: 'tdd',
      reasoning: 'manual',
      userConfirmed: true,
    })
    for (const stage of ['brainstorm', 'spec', 'plan', 'search'] as const) {
      await hsm.transition(stage)
      hsm.recordPrimitive('sequentialThinking')
      hsm.recordPrimitive('searchAndVerify')
      hsm.recordPrimitive('askUser')
    }
    await hsm.transition('implement')
    await hsm.transition('review')
    await hsm.transition('recap')
    const stages = events
      .filter((e) => e.type === 'harness.stage.enter')
      .map((e) => (e as { stage: string }).stage)
    expect(stages).toEqual(['brainstorm', 'spec', 'plan', 'search', 'implement', 'review', 'recap'])
    // scratchpad write happens lazily on transition; verify after the last transition
    expect(fs.existsSync(hsm.snapshot().scratchpadPath)).toBe(true)
  })

  it('investigate/hell still forbids implement (red line)', async () => {
    const hsm = new HarnessStateMachine({ sessionId: 's2', bus: createEventBus(), home, mode: 'deep' })
    hsm.setTriage({
      profile: 'investigate',
      difficulty: 'hell',
      testStrategy: 'tdd',
      reasoning: 'manual',
      userConfirmed: true,
    })
    await hsm.transition('search')
    await expect(hsm.transition('implement')).rejects.toThrow(/forbidden/)
  })

  it('fast mode bypasses brainstorm', async () => {
    const hsm = new HarnessStateMachine({ sessionId: 's3', bus: createEventBus(), home, mode: 'fast' })
    hsm.setTriage({
      profile: 'feature',
      difficulty: 'medium',
      testStrategy: 'tdd',
      reasoning: 'manual',
      userConfirmed: true,
    })
    await hsm.transition('search')
    expect(hsm.snapshot().currentStage).toBe('search')
  })
})
