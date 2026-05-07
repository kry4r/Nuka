// test/slash/settings.test.ts
import { describe, it, expect } from 'vitest'
import { SettingsCommand, ConfigCommand } from '../../src/slash/settings'

describe('/settings', () => {
  it('opens the config submenu when at least one provider exists', async () => {
    const ctx = { config: { providers: [{ id: 'p1' }] } } as any
    expect(await SettingsCommand.run('', ctx)).toEqual({
      type: 'dialog',
      dialog: { kind: 'settings' },
    })
  })

  it('opens the dialog even with zero providers (no `nuka init` gate)', async () => {
    const ctx = { config: { providers: [] } } as any
    expect(await SettingsCommand.run('', ctx)).toEqual({
      type: 'dialog',
      dialog: { kind: 'settings' },
    })
  })

  it('/config alias also opens the dialog with zero providers', async () => {
    const ctx = { config: { providers: [] } } as any
    expect(await ConfigCommand.run('', ctx)).toEqual({
      type: 'dialog',
      dialog: { kind: 'settings' },
    })
  })
})
