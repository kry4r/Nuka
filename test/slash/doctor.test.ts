// test/slash/doctor.test.ts
import { describe, it, expect, vi } from 'vitest'
import { DoctorCommand } from '../../src/slash/doctor'
import type { SlashContext } from '../../src/slash/types'
import { SessionManager } from '../../src/core/session/manager'

vi.mock('../../src/core/doctor/run', () => ({
  runDoctor: async () => ({
    ok: true,
    checks: [
      { name: 'node', status: 'ok', detail: 'Node v20.0.0' },
      { name: 'disk', status: 'ok', detail: 'writable' },
    ],
  }),
}))

function makeCtx(): SlashContext {
  const sessions = new SessionManager()
  sessions.start({ providerId: 'p', model: 'm' })
  return {
    sessions,
    providers: { listProviders: () => [], getProviderConfig: () => undefined } as any,
    config: { providers: [], active: { providerId: 'p' } } as any,
  }
}

describe('/doctor slash command', () => {
  it('returns a dialog result of kind doctor', async () => {
    const ctx = makeCtx()
    const result = await DoctorCommand.run('', ctx)
    expect(result.type).toBe('dialog')
    if (result.type === 'dialog') {
      expect(result.dialog.kind).toBe('doctor')
      if (result.dialog.kind === 'doctor') {
        expect(result.dialog.report.ok).toBe(true)
        expect(result.dialog.report.checks).toHaveLength(2)
      }
    }
  })

  it('command name is "doctor"', () => {
    expect(DoctorCommand.name).toBe('doctor')
  })

  it('has a description', () => {
    expect(typeof DoctorCommand.description).toBe('string')
    expect(DoctorCommand.description.length).toBeGreaterThan(0)
  })
})
