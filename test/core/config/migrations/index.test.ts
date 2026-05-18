import { describe, it, expect } from 'vitest'
import {
  loadAndMigrate,
  runMigrations,
  atomicWriteYaml,
  MIGRATIONS,
  CURRENT_CONFIG_VERSION,
  MigrationError,
} from '../../../../src/core/config/migrations'

describe('migrations index barrel', () => {
  it('re-exports the public surface', () => {
    expect(typeof loadAndMigrate).toBe('function')
    expect(typeof runMigrations).toBe('function')
    expect(typeof atomicWriteYaml).toBe('function')
    expect(Array.isArray(MIGRATIONS)).toBe(true)
    expect(typeof CURRENT_CONFIG_VERSION).toBe('number')
    expect(typeof MigrationError).toBe('function')
  })

  it('MigrationError is throwable and instanceof-checkable', () => {
    try { throw new MigrationError('x', 1, 2) }
    catch (e) { expect(e).toBeInstanceOf(MigrationError) }
  })
})
