// test/slash/compact.test.ts
import { describe, it, expect } from 'vitest'
import { CompactCommand } from '../../src/slash/compact'
import { SessionManager } from '../../src/core/session/manager'
import type { SlashContext } from '../../src/slash/types'

function ctx(): SlashContext {
  const sessions = new SessionManager()
  sessions.start({ providerId: 'p', model: 'm' })
  return {
    sessions,
    providers: { resolveFor: () => ({}) } as any,
    config: { providers: [], active: { providerId: 'p' } } as any,
  }
}

describe('/compact', () => {
  it('returns a compact effect', async () => {
    expect(await CompactCommand.run('', ctx())).toEqual({
      type: 'effect',
      effect: { kind: 'compact' },
    })
  })
})
