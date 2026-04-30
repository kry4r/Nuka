// test/slash/settings.test.ts
import { describe, it, expect } from 'vitest'
import { SettingsCommand } from '../../src/slash/settings'

describe('/settings', () => {
  it('opens the config submenu when at least one provider exists', async () => {
    const ctx = { config: { providers: [{ id: 'p1' }] } } as any
    expect(await SettingsCommand.run('', ctx)).toEqual({
      type: 'dialog',
      dialog: { kind: 'settings' },
    })
  })

  it('returns an onboarding hint when no providers are configured (offline boot)', async () => {
    const ctx = { config: { providers: [] } } as any
    const res = await SettingsCommand.run('', ctx)
    expect(res.type).toBe('text')
    if (res.type === 'text') {
      expect(res.text).toMatch(/nuka init/i)
    }
  })
})
