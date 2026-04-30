import { describe, it, expect, afterEach } from 'vitest'
import {
  isCoordinatorMode, COORDINATOR_INTERNAL_TOOLS, getCoordinatorUserContext, matchSessionMode,
} from '../../../src/core/agent/coordinatorMode'

describe('coordinatorMode', () => {
  afterEach(() => { delete process.env.NUKA_COORDINATOR_MODE })

  it('reads NUKA_COORDINATOR_MODE truthy values', () => {
    process.env.NUKA_COORDINATOR_MODE = '1'
    expect(isCoordinatorMode()).toBe(true)
    process.env.NUKA_COORDINATOR_MODE = 'true'
    expect(isCoordinatorMode()).toBe(true)
    process.env.NUKA_COORDINATOR_MODE = ''
    expect(isCoordinatorMode()).toBe(false)
  })

  it('exposes coordinator-internal tool whitelist', () => {
    expect(COORDINATOR_INTERNAL_TOOLS.has('send_message')).toBe(true)
    expect(COORDINATOR_INTERNAL_TOOLS.has('Read')).toBe(false)
  })

  it('getCoordinatorUserContext returns context only when mode is on', () => {
    delete process.env.NUKA_COORDINATOR_MODE
    expect(Object.keys(getCoordinatorUserContext({ tools: { list: () => [] } }))).toEqual([])
    process.env.NUKA_COORDINATOR_MODE = '1'
    const ctx = getCoordinatorUserContext({ tools: { list: () => [{ name: 'Read' }, { name: 'Edit' }] as never } })
    expect(typeof ctx.workerTools).toBe('string')
    expect(ctx.workerTools).toContain('Read')
  })

  it('matchSessionMode flips env on mismatch', () => {
    delete process.env.NUKA_COORDINATOR_MODE
    const msg = matchSessionMode('coordinator')
    expect(msg).toMatch(/Entered/)
    expect(process.env.NUKA_COORDINATOR_MODE).toBe('1')

    const msg2 = matchSessionMode('normal')
    expect(msg2).toMatch(/Exited/)
    expect(process.env.NUKA_COORDINATOR_MODE).toBeUndefined()

    expect(matchSessionMode(undefined)).toBeUndefined()
  })
})
