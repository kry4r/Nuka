// test/core/cost/displayEnabled.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isCostDisplayEnabled, COST_DISPLAY_ENV } from '../../../src/core/cost/displayEnabled'

describe('isCostDisplayEnabled', () => {
  let saved: string | undefined
  beforeEach(() => {
    saved = process.env[COST_DISPLAY_ENV]
    delete process.env[COST_DISPLAY_ENV]
  })
  afterEach(() => {
    if (saved === undefined) delete process.env[COST_DISPLAY_ENV]
    else process.env[COST_DISPLAY_ENV] = saved
  })

  it('returns false when the env var is unset', () => {
    expect(isCostDisplayEnabled()).toBe(false)
  })
  it('returns true when the env var is exactly "1"', () => {
    process.env[COST_DISPLAY_ENV] = '1'
    expect(isCostDisplayEnabled()).toBe(true)
  })
  it('returns false for unrelated values (truthy strings, "true", "yes")', () => {
    for (const v of ['true', 'yes', '0', '', 'TRUE', '2']) {
      process.env[COST_DISPLAY_ENV] = v
      expect(isCostDisplayEnabled(), `value=${v}`).toBe(false)
    }
  })
  it('respects an explicit env arg over process.env', () => {
    process.env[COST_DISPLAY_ENV] = '1'
    expect(isCostDisplayEnabled({})).toBe(false)
    expect(isCostDisplayEnabled({ [COST_DISPLAY_ENV]: '1' })).toBe(true)
  })
})
