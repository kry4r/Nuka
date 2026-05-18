import { describe, it, expect } from 'vitest'
import { MigrationError, CURRENT_CONFIG_VERSION } from '../../../../src/core/config/migrations/types'
import type { Migration } from '../../../../src/core/config/migrations/types'

describe('migration types', () => {
  it('CURRENT_CONFIG_VERSION is a positive integer >= 1', () => {
    expect(Number.isInteger(CURRENT_CONFIG_VERSION)).toBe(true)
    expect(CURRENT_CONFIG_VERSION).toBeGreaterThanOrEqual(1)
  })

  it('MigrationError carries from/to context', () => {
    const err = new MigrationError('boom', 1, 2)
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('MigrationError')
    expect(err.from).toBe(1)
    expect(err.to).toBe(2)
    expect(err.message).toContain('boom')
  })

  it('Migration<1,2> shape compiles', () => {
    const m: Migration = {
      from: 1,
      to: 2,
      migrate: (obj: Record<string, unknown>): Record<string, unknown> => {
        return { ...obj, version: 2 }
      },
    }
    expect(m.from).toBe(1)
    expect(m.to).toBe(2)
    expect(m.migrate({ foo: 'bar' })).toEqual({ foo: 'bar', version: 2 })
  })
})
