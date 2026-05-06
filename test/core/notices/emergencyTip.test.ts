// test/core/notices/emergencyTip.test.ts
import { describe, it, expect } from 'vitest'
import { getEmergencyTipFromConfig, getEmergencyTip } from '../../../src/core/notices/emergencyTip'
import type { Config } from '../../../src/core/config/schema'

const baseConfig: Config = {
  providers: [],
  active: { providerId: '' },
}

describe('getEmergencyTipFromConfig', () => {
  it('returns null when notices is undefined', () => {
    expect(getEmergencyTipFromConfig(baseConfig)).toBeNull()
  })

  it('returns null when notices is empty', () => {
    const cfg: Config = { ...baseConfig, notices: {} }
    expect(getEmergencyTipFromConfig(cfg)).toBeNull()
  })

  it('returns null when notices.emergency.tip is empty (defensive)', () => {
    // The zod schema enforces .min(1), but in-memory fixtures can bypass that.
    const cfg = { ...baseConfig, notices: { emergency: { tip: '' } } } as Config
    expect(getEmergencyTipFromConfig(cfg)).toBeNull()
  })

  it('returns the tip when only text is set', () => {
    const cfg: Config = {
      ...baseConfig,
      notices: { emergency: { tip: 'maintenance window 22:00 UTC' } },
    }
    expect(getEmergencyTipFromConfig(cfg)).toEqual({
      tip: 'maintenance window 22:00 UTC',
    })
  })

  it.each(['dim', 'warning', 'error'] as const)('round-trips color=%s', (color) => {
    const cfg: Config = {
      ...baseConfig,
      notices: { emergency: { tip: 'heads up', color } },
    }
    expect(getEmergencyTipFromConfig(cfg)).toEqual({ tip: 'heads up', color })
  })
})

describe('getEmergencyTip (legacy stub)', () => {
  it('always returns null', () => {
    expect(getEmergencyTip()).toBeNull()
  })
})
