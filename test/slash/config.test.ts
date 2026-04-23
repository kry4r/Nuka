// test/slash/config.test.ts
import { describe, it, expect } from 'vitest'
import { ConfigCommand } from '../../src/slash/config'

describe('/config', () => {
  it('opens the config editor dialog', async () => {
    expect(await ConfigCommand.run('', {} as any)).toEqual({
      type: 'dialog',
      dialog: { kind: 'config-editor' },
    })
  })
})
