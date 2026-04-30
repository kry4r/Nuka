// test/slash/resume.test.ts
import { describe, it, expect } from 'vitest'
import { SessionManager } from '../../src/core/session/manager'
import { ResumeCommand } from '../../src/slash/resume'
import type { SlashContext } from '../../src/slash/types'

function makeCtx(sessions: SessionManager): SlashContext {
  return {
    sessions,
    providers: { getProviderConfig: () => undefined, listProviders: () => [] } as any,
    config: { providers: [], active: { providerId: 'p' } } as any,
  }
}

describe('/resume', () => {
  it('returns a session-picker dialog descriptor', async () => {
    const m = new SessionManager()
    const res = await ResumeCommand.run('', makeCtx(m))
    expect(res).toEqual({ type: 'dialog', dialog: { kind: 'session-picker' } })
  })
})
