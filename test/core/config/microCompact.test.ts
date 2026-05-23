import { describe, expect, it } from 'vitest'
import { ConfigSchema } from '../../../src/core/config/schema'
import { microCompactOptionsFromConfig } from '../../../src/core/config/microCompact'

function config(input: unknown = {}) {
  return ConfigSchema.parse({
    providers: [],
    active: { providerId: '' },
    ...input,
  })
}

describe('microCompactOptionsFromConfig', () => {
  it('enables local microcompact by default', () => {
    expect(microCompactOptionsFromConfig(config())).toEqual({ keepRecent: 4 })
  })

  it('uses configured keepRecent', () => {
    const cfg = config({
      compact: {
        microCompact: {
          enabled: true,
          keepRecent: 2,
        },
      },
    })

    expect(microCompactOptionsFromConfig(cfg)).toEqual({ keepRecent: 2 })
  })

  it('returns undefined when disabled', () => {
    const cfg = config({
      compact: {
        microCompact: {
          enabled: false,
        },
      },
    })

    expect(microCompactOptionsFromConfig(cfg)).toBeUndefined()
  })
})
