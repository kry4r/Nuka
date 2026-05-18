import { describe, it, expect } from 'vitest'
import { ConfigSchema } from '../../../../src/core/config/schema'

describe('ConfigSchema.version', () => {
  it('defaults to 1 when absent (backwards compatible)', () => {
    const parsed = ConfigSchema.parse({})
    expect(parsed.version).toBe(1)
  })

  it('preserves an explicit version: 2', () => {
    const parsed = ConfigSchema.parse({ version: 2 })
    expect(parsed.version).toBe(2)
  })

  it('rejects non-positive versions', () => {
    expect(() => ConfigSchema.parse({ version: 0 })).toThrow()
    expect(() => ConfigSchema.parse({ version: -1 })).toThrow()
  })

  it('rejects non-integer versions', () => {
    expect(() => ConfigSchema.parse({ version: 1.5 })).toThrow()
  })

  it('legacy fields still validate alongside version', () => {
    const parsed = ConfigSchema.parse({
      version: 1,
      providers: [],
      active: { providerId: '' },
    })
    expect(parsed.version).toBe(1)
    expect(parsed.active.providerId).toBe('')
  })
})
