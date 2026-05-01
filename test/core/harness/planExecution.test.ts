import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { HarnessStateMachine } from '../../../src/core/harness/state'
import { createEventBus } from '../../../src/core/events/bus'
import { ensureNukaLayout } from '../../../src/core/paths'
import { initMatrix } from '../../../src/core/harness/matrix'
import { loadGraph } from '../../../src/core/coordination/persist'

const validDecompose = JSON.stringify({
  tasks: [
    { id: 't1', title: 'A', profile: 'feature', testStrategy: 'tdd' },
    { id: 't2', title: 'B', profile: 'feature', testStrategy: 'tdd' },
  ],
  edges: [['t1', 't2', 'order']],
})

describe('HarnessStateMachine.planExecution', () => {
  let home: string

  beforeAll(() => initMatrix(path.join(process.cwd(), 'assets/harness/profiles.yaml')))

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-plan-'))
    ensureNukaLayout(home)
  })

  it('simple → inline (no graph file)', async () => {
    const hsm = new HarnessStateMachine({ sessionId: 'p1', bus: createEventBus(), home, mode: 'deep' })
    hsm.setTriage({
      profile: 'feature', difficulty: 'simple', testStrategy: 'tdd', reasoning: 'r', userConfirmed: true,
    })
    const fork = vi.fn()
    const plan = await hsm.planExecution('do simple thing', { runFork: fork })
    expect(plan.kind).toBe('inline')
    expect(fs.existsSync(hsm.snapshot().taskGraphPath)).toBe(false)
    expect(fork).not.toHaveBeenCalled()
  })

  it('hard → graph (graph saved to taskGraphPath)', async () => {
    const hsm = new HarnessStateMachine({ sessionId: 'p2', bus: createEventBus(), home, mode: 'deep' })
    hsm.setTriage({
      profile: 'feature', difficulty: 'hard', testStrategy: 'cross-module', reasoning: 'r', userConfirmed: true,
    })
    const fork = vi.fn().mockResolvedValue({ text: validDecompose })
    const plan = await hsm.planExecution('do hard thing', { runFork: fork })
    expect(plan.kind).toBe('graph')
    if (plan.kind === 'graph') expect(plan.listening).toBe(false)
    const loaded = loadGraph(hsm.snapshot().taskGraphPath)
    expect(loaded?.snapshot().rootMessage).toBe('do hard thing')
    expect(Object.keys(loaded!.snapshot().nodes)).toHaveLength(2)
  })

  it('hell → graph + listening=true', async () => {
    const hsm = new HarnessStateMachine({ sessionId: 'p3', bus: createEventBus(), home, mode: 'deep' })
    hsm.setTriage({
      profile: 'feature', difficulty: 'hell', testStrategy: 'multi-test', reasoning: 'r', userConfirmed: true,
    })
    const fork = vi.fn().mockResolvedValue({ text: validDecompose })
    const plan = await hsm.planExecution('do hell thing', { runFork: fork })
    expect(plan.kind).toBe('graph')
    if (plan.kind === 'graph') expect(plan.listening).toBe(true)
  })

  it('未 triage 时抛错', async () => {
    const hsm = new HarnessStateMachine({ sessionId: 'p4', bus: createEventBus(), home, mode: 'deep' })
    await expect(hsm.planExecution('x', { runFork: vi.fn() })).rejects.toThrow(/triage/)
  })
})
