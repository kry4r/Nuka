import { describe, it, expect } from 'vitest'
import { runMigrations } from '../../../../src/core/config/migrations/run'
import { MigrationError } from '../../../../src/core/config/migrations/types'
import type { Migration } from '../../../../src/core/config/migrations/types'

describe('runMigrations', () => {
  it('treats a missing version as version 1', () => {
    const result = runMigrations({ providers: [] })
    expect(result.ranFrom).toBe(1)
    expect(result.changed).toBe(true)
    expect((result.obj as { version: number }).version).toBe(2)
  })

  it('treats version=1 the same as no version', () => {
    const result = runMigrations({ version: 1, providers: [] })
    expect(result.ranFrom).toBe(1)
    expect((result.obj as { version: number }).version).toBe(2)
  })

  it('returns unchanged=false when already at latest version', () => {
    const result = runMigrations({ version: 2, providers: [] })
    expect(result.changed).toBe(false)
    expect(result.ranFrom).toBe(2)
    expect(result.ranTo).toBe(2)
  })

  it('applies migrations sequentially with custom registry', () => {
    const m12: Migration = {
      from: 1, to: 2,
      migrate: (o) => ({ ...o, version: 2, stepA: true }),
    }
    const m23: Migration = {
      from: 2, to: 3,
      migrate: (o) => ({ ...o, version: 3, stepB: true }),
    }
    const result = runMigrations({}, { registry: [m12, m23] })
    expect(result.obj).toMatchObject({ version: 3, stepA: true, stepB: true })
    expect(result.ranFrom).toBe(1)
    expect(result.ranTo).toBe(3)
  })

  it('wraps a throwing migrator in MigrationError', () => {
    const bad: Migration = {
      from: 1, to: 2,
      migrate: () => { throw new Error('kaboom') },
    }
    expect(() => runMigrations({}, { registry: [bad] })).toThrow(MigrationError)
    try {
      runMigrations({}, { registry: [bad] })
    } catch (err) {
      expect(err).toBeInstanceOf(MigrationError)
      const me = err as MigrationError
      expect(me.from).toBe(1)
      expect(me.to).toBe(2)
      expect(me.message).toContain('kaboom')
    }
  })

  it('throws when the on-disk version is higher than CURRENT_CONFIG_VERSION', () => {
    expect(() => runMigrations({ version: 99 })).toThrow(/from the future/i)
  })

  it('rejects non-record inputs (arrays, primitives)', () => {
    expect(() => runMigrations([] as unknown as Record<string, unknown>)).toThrow()
    expect(() => runMigrations(null as unknown as Record<string, unknown>)).toThrow()
  })

  it('does not mutate the input object on success', () => {
    const input = { version: 1, providers: [] as unknown[] }
    runMigrations(input)
    expect(input.version).toBe(1)
  })
})
