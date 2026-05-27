import { describe, expect, it } from 'vitest'
import { SessionManager } from '../../src/core/session/manager'
import { PermissionsCommand } from '../../src/slash/permissions'
import type { SlashContext } from '../../src/slash/types'

function ctx(config: SlashContext['config']): SlashContext {
  const sessions = new SessionManager()
  sessions.start({ providerId: 'p', model: 'm' })
  return {
    sessions,
    providers: { getProviderConfig: () => undefined, listProviders: () => [] } as any,
    config,
  }
}

describe('/permissions', () => {
  it('renders active profile identity, inheritance, and resolved rules', async () => {
    const res = await PermissionsCommand.run('', ctx({
      providers: [],
      active: { providerId: '' },
      permissions: {
        active: 'dev',
        profiles: {
          audit: {
            description: 'Read-only review.',
            rules: { write: 'deny', exec: 'deny', network: 'deny' },
          },
          dev: {
            description: 'Day-to-day coding.',
            extends: 'audit',
            rules: { write: 'ask', exec: 'ask' },
          },
        },
      },
    } as any))

    expect(res.type).toBe('text')
    if (res.type === 'text') {
      expect(res.text).toContain('Active permission profile')
      expect(res.text).toContain('id       dev')
      expect(res.text).toContain('extends  audit')
      expect(res.text).toContain('inherits audit')
      expect(res.text).toContain('rules    write=ask exec=ask network=deny')
      expect(res.text).toContain('dev - Day-to-day coding.')
    }
  })

  it('lists built-ins even when no active profile is configured', async () => {
    const res = await PermissionsCommand.run('', ctx({
      providers: [],
      active: { providerId: '' },
    } as any))

    expect(res.type).toBe('text')
    if (res.type === 'text') {
      expect(res.text).toContain('active   (none)')
      expect(res.text).toContain(':read-only')
      expect(res.text).toContain(':workspace')
      expect(res.text).toContain(':danger-full-access')
    }
  })
})
