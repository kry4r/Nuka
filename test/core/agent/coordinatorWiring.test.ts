import { describe, it, expect, afterEach } from 'vitest'
import { applyCoordinatorFilter } from '../../../src/core/agent/loop'
import { COORDINATOR_INTERNAL_TOOLS } from '../../../src/core/agent/coordinatorMode'

const fakeTools = [
  { name: 'team_create' }, { name: 'send_message' }, { name: 'Read' }, { name: 'Edit' }, { name: 'Bash' },
] as { name: string }[]

describe('applyCoordinatorFilter', () => {
  afterEach(() => { delete process.env.NUKA_COORDINATOR_MODE })

  it('coordinator mode lead: keeps only coordinator-internal', () => {
    process.env.NUKA_COORDINATOR_MODE = '1'
    const out = applyCoordinatorFilter(fakeTools, { isWorker: false })
    expect(out.map((t: { name: string }) => t.name).sort()).toEqual([...COORDINATOR_INTERNAL_TOOLS].filter(n => fakeTools.some((f: { name: string }) => f.name === n)).sort())
  })

  it('coordinator mode worker: drops coordinator-internal', () => {
    process.env.NUKA_COORDINATOR_MODE = '1'
    const out = applyCoordinatorFilter(fakeTools, { isWorker: true })
    expect(out.map((t: { name: string }) => t.name)).toEqual(['Read', 'Edit', 'Bash'])
  })

  it('non-coordinator mode: identity filter', () => {
    const out = applyCoordinatorFilter(fakeTools, { isWorker: false })
    expect(out.length).toBe(fakeTools.length)
  })
})
