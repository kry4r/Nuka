import { describe, expect, it } from 'vitest'
import {
  listPermissionProfileSummaries,
  refreshManagedPermissionCatalog,
  resolvePermissionProfile,
} from '../../../src/core/permission/profiles'

describe('permission profile catalog', () => {
  it('lists built-in and configured profiles for audit surfaces', () => {
    const summaries = listPermissionProfileSummaries({
      profiles: {
        dev: { description: 'Day-to-day coding.' },
        audit: { description: 'Inspect without writes.' },
      },
    })

    expect(summaries).toEqual([
      { id: ':read-only' },
      { id: ':workspace' },
      { id: ':danger-full-access' },
      { id: 'audit', description: 'Inspect without writes.' },
      { id: 'dev', description: 'Day-to-day coding.' },
    ])
  })

  it('resolves active profile inheritance with child rules winning', () => {
    const resolved = resolvePermissionProfile({
      active: 'dev',
      profiles: {
        audit: {
          description: 'Inspect without writes.',
          rules: { write: 'deny', exec: 'deny', network: 'deny' },
        },
        dev: {
          description: 'Day-to-day coding.',
          extends: 'audit',
          rules: { write: 'ask', exec: 'ask' },
        },
      },
    })

    expect(resolved).toEqual({
      id: 'dev',
      description: 'Day-to-day coding.',
      extends: 'audit',
      inherited: ['audit'],
      rules: {
        write: 'ask',
        exec: 'ask',
        network: 'deny',
      },
    })
  })

  it('supports built-in profile parents', () => {
    const resolved = resolvePermissionProfile({
      active: 'ci',
      profiles: {
        ci: {
          extends: ':workspace',
          rules: { network: 'deny' },
        },
      },
    })

    expect(resolved?.inherited).toEqual([':workspace'])
    expect(resolved?.rules).toMatchObject({
      write: 'ask',
      exec: 'ask',
      network: 'deny',
    })
  })

  it('rejects inheritance cycles', () => {
    expect(() =>
      resolvePermissionProfile({
        active: 'a',
        profiles: {
          a: { extends: 'b' },
          b: { extends: 'a' },
        },
      }),
    ).toThrow(/cycle/i)
  })

  it('rejects missing active and parent profiles with clear errors', () => {
    expect(() =>
      resolvePermissionProfile({
        active: 'missing',
        profiles: {},
      }),
    ).toThrow(/active permission profile "missing" is undefined/)

    expect(() =>
      resolvePermissionProfile({
        active: 'dev',
        profiles: {
          dev: { extends: 'missing-parent' },
        },
      }),
    ).toThrow(/permission profile "dev" extends undefined profile "missing-parent"/)
  })

  it('refreshes managed profiles without deleting local profiles', () => {
    const refreshed = refreshManagedPermissionCatalog(
      {
        active: 'local',
        profiles: {
          local: { description: 'User-owned.', rules: { write: 'ask' } },
          stale: { description: 'Old managed.', managed: true, rules: { write: 'allow' } },
        },
      },
      {
        active: 'managed-standard',
        profiles: {
          'managed-standard': {
            description: 'Managed baseline.',
            extends: ':workspace',
            rules: { network: 'deny' },
          },
        },
      },
    )

    expect(refreshed.active).toBe('managed-standard')
    expect(refreshed.profiles?.local).toEqual({
      description: 'User-owned.',
      rules: { write: 'ask' },
      managed: false,
    })
    expect(refreshed.profiles?.stale).toBeUndefined()
    expect(refreshed.profiles?.['managed-standard']).toEqual({
      description: 'Managed baseline.',
      extends: ':workspace',
      rules: { network: 'deny' },
      managed: true,
    })
  })
})
