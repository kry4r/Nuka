import { describe, it, expect, afterEach } from 'vitest'
import { isPersistEnabled, PERSIST_ENV } from '../../../../src/core/session/history/persist'

describe('isPersistEnabled', () => {
  const old = process.env[PERSIST_ENV]
  afterEach(() => {
    if (old === undefined) delete process.env[PERSIST_ENV]
    else process.env[PERSIST_ENV] = old
  })

  it('returns false when env unset', () => {
    delete process.env[PERSIST_ENV]
    expect(isPersistEnabled(process.env)).toBe(false)
  })
  it('returns true for "1"', () => {
    process.env[PERSIST_ENV] = '1'
    expect(isPersistEnabled(process.env)).toBe(true)
  })
  it('returns true for "true" (case-insensitive)', () => {
    process.env[PERSIST_ENV] = 'TRUE'
    expect(isPersistEnabled(process.env)).toBe(true)
  })
  it('returns false for "0" or "false" or arbitrary', () => {
    process.env[PERSIST_ENV] = '0'
    expect(isPersistEnabled(process.env)).toBe(false)
    process.env[PERSIST_ENV] = 'false'
    expect(isPersistEnabled(process.env)).toBe(false)
    process.env[PERSIST_ENV] = 'no'
    expect(isPersistEnabled(process.env)).toBe(false)
  })
})
