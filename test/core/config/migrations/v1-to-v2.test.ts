import { describe, it, expect } from 'vitest'
import { v1ToV2 } from '../../../../src/core/config/migrations/v1-to-v2'

describe('v1-to-v2 identity migration', () => {
  it('declares from=1 / to=2', () => {
    expect(v1ToV2.from).toBe(1)
    expect(v1ToV2.to).toBe(2)
  })

  it('bumps version to 2 on an otherwise empty object', () => {
    expect(v1ToV2.migrate({})).toEqual({ version: 2 })
  })

  it('preserves all unrelated keys', () => {
    const input = {
      version: 1,
      providers: [{ id: 'a', name: 'A' }],
      active: { providerId: 'a' },
      theme: { name: 'default-dark' },
    }
    const out = v1ToV2.migrate(input)
    expect(out.version).toBe(2)
    expect(out.providers).toEqual(input.providers)
    expect(out.active).toEqual(input.active)
    expect(out.theme).toEqual(input.theme)
  })

  it('returns a new object (does not mutate input)', () => {
    const input = { version: 1, providers: [] }
    const out = v1ToV2.migrate(input)
    expect(out).not.toBe(input)
    expect(input.version).toBe(1)
  })
})
