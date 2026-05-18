import { describe, it, expect } from 'vitest'
import { MIGRATIONS } from '../../../../src/core/config/migrations/registry'
import { CURRENT_CONFIG_VERSION } from '../../../../src/core/config/migrations/types'

describe('MIGRATIONS registry invariants', () => {
  it('is non-empty', () => {
    expect(MIGRATIONS.length).toBeGreaterThan(0)
  })

  it('first migration starts at version 1', () => {
    expect(MIGRATIONS[0]?.from).toBe(1)
  })

  it('every step is contiguous (to === from + 1)', () => {
    for (const m of MIGRATIONS) {
      expect(m.to).toBe(m.from + 1)
    }
  })

  it('chain is gap-free (each step.from matches previous step.to)', () => {
    for (let i = 1; i < MIGRATIONS.length; i++) {
      const prev = MIGRATIONS[i - 1]
      const cur = MIGRATIONS[i]
      expect(cur?.from).toBe(prev?.to)
    }
  })

  it('last migration ends at CURRENT_CONFIG_VERSION', () => {
    const last = MIGRATIONS[MIGRATIONS.length - 1]
    expect(last?.to).toBe(CURRENT_CONFIG_VERSION)
  })
})
