// test/slash/config.test.ts
import { describe, it, expect } from 'vitest'
import { ConfigCommand } from '../../src/slash/config'

describe('/config', () => {
  it('opens the config submenu when at least one provider exists', async () => {
    const ctx = { config: { providers: [{ id: 'p1' }] } } as any
    expect(await ConfigCommand.run('', ctx)).toEqual({
      type: 'dialog',
      dialog: { kind: 'config' },
    })
  })

  it('returns an onboarding hint when no providers are configured (offline boot)', async () => {
    const ctx = { config: { providers: [] } } as any
    const res = await ConfigCommand.run('', ctx)
    expect(res.type).toBe('text')
    if (res.type === 'text') {
      expect(res.text).toMatch(/nuka init/i)
    }
  })
})
