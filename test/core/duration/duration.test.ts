// test/core/duration/duration.test.ts
import { describe, it, expect } from 'vitest'
import {
  UNIT_MS,
  formatDuration,
  parseDuration,
  formatDurationApprox,
  formatTimestamp,
  formatBytes,
  formatFileSize,
} from '../../../src/core/duration'

// ─── UNIT_MS ─────────────────────────────────────────────────────────

describe('UNIT_MS', () => {
  it('exposes canonical conversions', () => {
    expect(UNIT_MS.ms).toBe(1)
    expect(UNIT_MS.s).toBe(1000)
    expect(UNIT_MS.m).toBe(60_000)
    expect(UNIT_MS.h).toBe(3_600_000)
    expect(UNIT_MS.d).toBe(86_400_000)
    expect(UNIT_MS.w).toBe(7 * 86_400_000)
  })

  it('is frozen', () => {
    expect(Object.isFrozen(UNIT_MS)).toBe(true)
  })
})

// ─── formatDuration ─────────────────────────────────────────────────

describe('formatDuration', () => {
  it('zero → 0s', () => {
    expect(formatDuration(0)).toBe('0s')
  })

  it('zero verbose → 0 seconds', () => {
    expect(formatDuration(0, { verbose: true })).toBe('0 seconds')
  })

  it('sub-second (234ms) → 234ms', () => {
    expect(formatDuration(234)).toBe('234ms')
  })

  it('sub-second rounds (234.4ms) → 234ms', () => {
    expect(formatDuration(234.4)).toBe('234ms')
  })

  it('sub-second rounds (234.5ms) → 235ms', () => {
    expect(formatDuration(234.5)).toBe('235ms')
  })

  it('non-integer seconds < 60s (1500ms) → 1.5s', () => {
    expect(formatDuration(1500)).toBe('1.5s')
  })

  it('non-integer seconds (45_600ms) → 45.6s', () => {
    expect(formatDuration(45_600)).toBe('45.6s')
  })

  it('whole seconds (45_000ms) → 45s (no decimal)', () => {
    expect(formatDuration(45_000)).toBe('45s')
  })

  it('one minute exactly → 1m', () => {
    expect(formatDuration(60_000)).toBe('1m')
  })

  it('1.5 min (90_000) → 1m 30s', () => {
    expect(formatDuration(90_000)).toBe('1m 30s')
  })

  it('one hour exactly → 1h', () => {
    expect(formatDuration(3_600_000)).toBe('1h')
  })

  it('1h 23m 45s (precision default 2 → "1h 23m")', () => {
    const ms = UNIT_MS.h + 23 * UNIT_MS.m + 45 * UNIT_MS.s
    expect(formatDuration(ms)).toBe('1h 23m')
  })

  it('1h 23m 45s with precision=3', () => {
    const ms = UNIT_MS.h + 23 * UNIT_MS.m + 45 * UNIT_MS.s
    expect(formatDuration(ms, { precision: 3 })).toBe('1h 23m 45s')
  })

  it('1h 23m 45s with precision=1', () => {
    const ms = UNIT_MS.h + 23 * UNIT_MS.m + 45 * UNIT_MS.s
    expect(formatDuration(ms, { precision: 1 })).toBe('1h')
  })

  it('precision=Infinity shows all non-zero units', () => {
    const ms = UNIT_MS.d + UNIT_MS.h + UNIT_MS.m + UNIT_MS.s
    expect(formatDuration(ms, { precision: Infinity })).toBe('1d 1h 1m 1s')
  })

  it('one day → 1d', () => {
    expect(formatDuration(86_400_000)).toBe('1d')
  })

  it('3d 4h', () => {
    expect(formatDuration(3 * UNIT_MS.d + 4 * UNIT_MS.h)).toBe('3d 4h')
  })

  it('2w 3d', () => {
    expect(formatDuration(2 * UNIT_MS.w + 3 * UNIT_MS.d)).toBe('2w 3d')
  })

  it('compact mode drops spaces', () => {
    const ms = UNIT_MS.h + 23 * UNIT_MS.m
    expect(formatDuration(ms, { compact: true })).toBe('1h23m')
  })

  it('verbose mode singular/plural', () => {
    expect(formatDuration(60_000, { verbose: true })).toBe('1 minute')
    expect(formatDuration(120_000, { verbose: true })).toBe('2 minutes')
    expect(formatDuration(3_600_000 + 60_000, { verbose: true })).toBe(
      '1 hour 1 minute',
    )
    expect(formatDuration(2 * UNIT_MS.h + 30 * UNIT_MS.m, { verbose: true })).toBe(
      '2 hours 30 minutes',
    )
  })

  it('verbose mode for sub-second', () => {
    expect(formatDuration(234, { verbose: true })).toBe('234 milliseconds')
    expect(formatDuration(1, { verbose: true })).toBe('1 millisecond')
  })

  it('negative duration → leading minus', () => {
    expect(formatDuration(-90_000)).toBe('-1m 30s')
    expect(formatDuration(-234)).toBe('-234ms')
    expect(formatDuration(-1500)).toBe('-1.5s')
  })

  it('trimTrailingZeros default trims', () => {
    // 3661s = 1h 1m 1s → at precision 3 you'd see all three.
    // But 1h 0m 1s would normally trim to '1h' under default... only when
    // value is zero. We need a case with a hole — use 3600s = 1h 0m 0s.
    expect(formatDuration(UNIT_MS.h, { precision: 3 })).toBe('1h')
  })

  it('trimTrailingZeros disabled keeps zeros up to precision', () => {
    expect(
      formatDuration(UNIT_MS.h, { precision: 3, trimTrailingZeros: false }),
    ).toBe('1h 0m 0s')
  })

  it('subSecondPrecision: false disables decimal & ms-suffix branches', () => {
    // 1500ms with subSec off and default precision 2: walk picks s=1, ms=500.
    expect(formatDuration(1500, { subSecondPrecision: false })).toBe('1s 500ms')
    // 45_600ms picks s=45, ms=600.
    expect(formatDuration(45_600, { subSecondPrecision: false })).toBe(
      '45s 600ms',
    )
    // With precision=1 we get just the most significant unit.
    expect(
      formatDuration(1500, { subSecondPrecision: false, precision: 1 }),
    ).toBe('1s')
    expect(
      formatDuration(45_600, { subSecondPrecision: false, precision: 1 }),
    ).toBe('45s')
  })

  it('subSecondPrecision: false for < 1ms still hits ms via general walk', () => {
    // 234ms with subSec off: skip both decimal branches; general walk
    // picks ms=234.
    expect(formatDuration(234, { subSecondPrecision: false })).toBe('234ms')
  })

  it('units restriction: no ms (sub-second decimal still kicks in)', () => {
    // 234ms with units excluding 'ms' but including 's': the 1.5s branch
    // fires because remaining < 60s and not exactly N seconds. Result
    // formatted as '0.2s' (one decimal). This is friendlier than '0s'.
    expect(formatDuration(234, { units: ['h', 'm', 's'] })).toBe('0.2s')
  })

  it('units restriction: no ms, subSecond off → falls to nearest unit', () => {
    expect(
      formatDuration(234, {
        units: ['h', 'm', 's'],
        subSecondPrecision: false,
      }),
    ).toBe('0s')
  })

  it('units restriction: only h/m → floor to minutes', () => {
    // 90_000ms = 1.5 minutes → floored to 1m (we don't round-up).
    expect(formatDuration(90_000, { units: ['h', 'm'] })).toBe('1m')
    // 120_000ms = 2 minutes exactly.
    expect(formatDuration(120_000, { units: ['h', 'm'] })).toBe('2m')
  })

  it('units passed in odd order are sorted', () => {
    expect(
      formatDuration(UNIT_MS.h + UNIT_MS.m, { units: ['s', 'm', 'h'] }),
    ).toBe('1h 1m')
  })

  it('NaN → "NaN"', () => {
    expect(formatDuration(NaN)).toBe('NaN')
  })

  it('Infinity → "Infinity"', () => {
    expect(formatDuration(Infinity)).toBe('Infinity')
    expect(formatDuration(-Infinity)).toBe('-Infinity')
  })

  it('large w/d value', () => {
    // 100w = 700d → precision 2 → '100w 0d' but with trim → '100w'
    expect(formatDuration(100 * UNIT_MS.w)).toBe('100w')
  })

  it('1ms verbose → 1 millisecond singular', () => {
    expect(formatDuration(1, { verbose: true })).toBe('1 millisecond')
  })
})

// ─── parseDuration ──────────────────────────────────────────────────

describe('parseDuration', () => {
  it('234ms', () => {
    expect(parseDuration('234ms')).toBe(234)
  })

  it('1s', () => {
    expect(parseDuration('1s')).toBe(1000)
  })

  it('45s', () => {
    expect(parseDuration('45s')).toBe(45_000)
  })

  it('1m', () => {
    expect(parseDuration('1m')).toBe(60_000)
  })

  it('1m 30s', () => {
    expect(parseDuration('1m 30s')).toBe(90_000)
  })

  it('1h 30m', () => {
    expect(parseDuration('1h 30m')).toBe(5_400_000)
  })

  it('compact 1h30m', () => {
    expect(parseDuration('1h30m')).toBe(5_400_000)
  })

  it('decimal 1.5h', () => {
    expect(parseDuration('1.5h')).toBe(5_400_000)
  })

  it('decimal 0.5d', () => {
    expect(parseDuration('0.5d')).toBe(43_200_000)
  })

  it('verbose 90 minutes', () => {
    expect(parseDuration('90 minutes')).toBe(5_400_000)
  })

  it('verbose 1 hour 30 minutes', () => {
    expect(parseDuration('1 hour 30 minutes')).toBe(5_400_000)
  })

  it('verbose 2 days', () => {
    expect(parseDuration('2 days')).toBe(2 * 86_400_000)
  })

  it('alias variations: hr, hrs, hour, hours', () => {
    expect(parseDuration('1hr')).toBe(3_600_000)
    expect(parseDuration('2 hrs')).toBe(7_200_000)
    expect(parseDuration('1 hour')).toBe(3_600_000)
    expect(parseDuration('2 hours')).toBe(7_200_000)
  })

  it('alias variations: min, mins, minute, minutes', () => {
    expect(parseDuration('5 min')).toBe(300_000)
    expect(parseDuration('5 mins')).toBe(300_000)
    expect(parseDuration('5 minute')).toBe(300_000)
    expect(parseDuration('5 minutes')).toBe(300_000)
  })

  it('alias variations: sec, secs, second, seconds', () => {
    expect(parseDuration('30 sec')).toBe(30_000)
    expect(parseDuration('30 secs')).toBe(30_000)
    expect(parseDuration('30 seconds')).toBe(30_000)
  })

  it('alias variations: ms, msec, millisecond', () => {
    expect(parseDuration('100 ms')).toBe(100)
    expect(parseDuration('100msec')).toBe(100)
    expect(parseDuration('100 milliseconds')).toBe(100)
  })

  it('full 1d 2h 30m 15s', () => {
    expect(parseDuration('1d 2h 30m 15s')).toBe(
      UNIT_MS.d + 2 * UNIT_MS.h + 30 * UNIT_MS.m + 15 * UNIT_MS.s,
    )
  })

  it('1w 3d', () => {
    expect(parseDuration('1w 3d')).toBe(UNIT_MS.w + 3 * UNIT_MS.d)
  })

  it('comma-separated tokens', () => {
    expect(parseDuration('1h, 30m')).toBe(5_400_000)
  })

  it('case-insensitive units', () => {
    expect(parseDuration('1H 30M')).toBe(5_400_000)
    expect(parseDuration('5 HOURS')).toBe(5 * UNIT_MS.h)
  })

  it('negative whole-string', () => {
    expect(parseDuration('-1h')).toBe(-3_600_000)
    expect(parseDuration('-1h 30m')).toBe(-5_400_000)
  })

  it('leading + sign', () => {
    expect(parseDuration('+5m')).toBe(300_000)
  })

  it('throws on empty string', () => {
    expect(() => parseDuration('')).toThrow(/Cannot parse duration/)
    expect(() => parseDuration('   ')).toThrow(/Cannot parse duration/)
  })

  it('throws on garbage', () => {
    expect(() => parseDuration('hello')).toThrow(/Cannot parse duration/)
    expect(() => parseDuration('1z')).toThrow(/unknown unit/)
    expect(() => parseDuration('1h foo 30m')).toThrow(/unexpected/)
    expect(() => parseDuration('1h trailing')).toThrow(/trailing/)
  })

  it('throws on non-string', () => {
    expect(() => parseDuration(null as unknown as string)).toThrow(
      /Cannot parse duration/,
    )
  })

  it('round-trips formatDuration output', () => {
    const samples = [
      0,
      234,
      1500,
      45_000,
      60_000,
      90_000,
      3_600_000,
      3_723_000, // 1h 2m 3s
      86_400_000,
      2 * UNIT_MS.w + 3 * UNIT_MS.d,
      UNIT_MS.d + 2 * UNIT_MS.h + 30 * UNIT_MS.m + 15 * UNIT_MS.s,
    ]
    for (const ms of samples) {
      const formatted = formatDuration(ms, { precision: Infinity })
      // 0 case: formatDuration → '0s' → parseDuration('0s') → 0
      // 1.5s case: '1.5s' → parseDuration → 1500 ms
      // Note: 234ms decimal floors don't matter because 234 is integer ms.
      const parsed = parseDuration(formatted)
      expect(parsed).toBe(ms)
    }
  })

  it('round-trips for compact formatDuration', () => {
    const samples = [60_000, 90_000, UNIT_MS.h + 23 * UNIT_MS.m]
    for (const ms of samples) {
      const formatted = formatDuration(ms, {
        precision: Infinity,
        compact: true,
      })
      const parsed = parseDuration(formatted)
      expect(parsed).toBe(ms)
    }
  })

  it('round-trips for verbose formatDuration', () => {
    const samples = [60_000, 90_000, UNIT_MS.h + 23 * UNIT_MS.m]
    for (const ms of samples) {
      const formatted = formatDuration(ms, {
        precision: Infinity,
        verbose: true,
      })
      const parsed = parseDuration(formatted)
      expect(parsed).toBe(ms)
    }
  })
})

// ─── formatDurationApprox ───────────────────────────────────────────

describe('formatDurationApprox', () => {
  it('zero → just now', () => {
    expect(formatDurationApprox(0)).toBe('just now')
  })

  it('sub-second past → just now', () => {
    expect(formatDurationApprox(-500)).toBe('just now')
  })

  it('sub-second future → just now', () => {
    expect(formatDurationApprox(500)).toBe('just now')
  })

  it('5s ago', () => {
    expect(formatDurationApprox(-5_000)).toBe('5s ago')
  })

  it('in 5s', () => {
    expect(formatDurationApprox(5_000)).toBe('in 5s')
  })

  it('5m ago', () => {
    expect(formatDurationApprox(-5 * UNIT_MS.m)).toBe('5m ago')
  })

  it('1h ago', () => {
    expect(formatDurationApprox(-UNIT_MS.h)).toBe('1h ago')
  })

  it('yesterday (~24h ago)', () => {
    expect(formatDurationApprox(-UNIT_MS.d)).toBe('yesterday')
    expect(formatDurationApprox(-UNIT_MS.d * 1.1)).toBe('yesterday')
    expect(formatDurationApprox(-UNIT_MS.d * 0.9)).toBe('yesterday')
  })

  it('tomorrow (~24h ahead)', () => {
    expect(formatDurationApprox(UNIT_MS.d)).toBe('tomorrow')
  })

  it('3 days ago (past yesterday window)', () => {
    expect(formatDurationApprox(-3 * UNIT_MS.d)).toBe('3d ago')
  })

  it('in 3 days', () => {
    expect(formatDurationApprox(3 * UNIT_MS.d)).toBe('in 3d')
  })

  it('long style', () => {
    expect(formatDurationApprox(-5 * UNIT_MS.s, { style: 'long' })).toBe(
      '5 seconds ago',
    )
    expect(formatDurationApprox(2 * UNIT_MS.m, { style: 'long' })).toBe(
      'in 2 minutes',
    )
    expect(formatDurationApprox(-3 * UNIT_MS.d, { style: 'long' })).toBe(
      '3 days ago',
    )
  })

  it('custom justNowThreshold', () => {
    // 100ms past: with threshold 50ms → not just now.
    expect(formatDurationApprox(-100, { justNowThreshold: 50 })).toBe('100ms ago')
  })

  it('Infinity passthrough via formatDuration', () => {
    expect(formatDurationApprox(Infinity)).toBe('Infinity')
    expect(formatDurationApprox(NaN)).toBe('NaN')
  })
})

// ─── formatTimestamp ────────────────────────────────────────────────

describe('formatTimestamp', () => {
  it('epoch ISO', () => {
    expect(formatTimestamp(new Date(0))).toBe('1970-01-01T00:00:00.000Z')
    expect(formatTimestamp(0)).toBe('1970-01-01T00:00:00.000Z')
  })

  it('short style', () => {
    expect(formatTimestamp(0, { style: 'short' })).toBe('1970-01-01 00:00:00')
  })

  it('date style', () => {
    expect(formatTimestamp(0, { style: 'date' })).toBe('1970-01-01')
  })

  it('time style', () => {
    expect(formatTimestamp(0, { style: 'time' })).toBe('00:00:00')
  })

  it('non-zero date', () => {
    // 2026-05-17 13:45:30 UTC
    const ms = Date.UTC(2026, 4, 17, 13, 45, 30)
    expect(formatTimestamp(ms, { style: 'short' })).toBe('2026-05-17 13:45:30')
    expect(formatTimestamp(ms, { style: 'date' })).toBe('2026-05-17')
    expect(formatTimestamp(ms, { style: 'time' })).toBe('13:45:30')
  })

  it('throws on invalid Date', () => {
    expect(() => formatTimestamp(new Date('not a date'))).toThrow(/invalid/)
    expect(() => formatTimestamp(NaN)).toThrow(/invalid/)
  })
})

// ─── formatBytes ────────────────────────────────────────────────────

describe('formatBytes', () => {
  it('0 → 0 B', () => {
    expect(formatBytes(0)).toBe('0 B')
  })

  it('1023 → 1023 B', () => {
    expect(formatBytes(1023)).toBe('1023 B')
  })

  it('1024 → 1 KB', () => {
    expect(formatBytes(1024)).toBe('1 KB')
  })

  it('1536 → 1.5 KB', () => {
    expect(formatBytes(1536)).toBe('1.5 KB')
  })

  it('1_500_000 → 1.4 MB', () => {
    expect(formatBytes(1_500_000)).toBe('1.4 MB')
  })

  it('1024**3 → 1 GB', () => {
    expect(formatBytes(1024 ** 3)).toBe('1 GB')
  })

  it('decimals=2', () => {
    expect(formatBytes(1536, { decimals: 2 })).toBe('1.5 KB')
    expect(formatBytes(1500_000, { decimals: 2 })).toBe('1.43 MB')
  })

  it('decimals=0', () => {
    expect(formatBytes(1536, { decimals: 0 })).toBe('2 KB')
    expect(formatBytes(1024 * 1024 + 1024 * 600, { decimals: 0 })).toBe('2 MB')
  })

  it('keepTrailingZero', () => {
    expect(formatBytes(1024, { keepTrailingZero: true })).toBe('1.0 KB')
    expect(formatBytes(1024, { keepTrailingZero: false })).toBe('1 KB')
  })

  it('space=false', () => {
    expect(formatBytes(1536, { space: false })).toBe('1.5KB')
    expect(formatBytes(1023, { space: false })).toBe('1023B')
  })

  it('negative', () => {
    expect(formatBytes(-1024)).toBe('-1 KB')
    expect(formatBytes(-1023)).toBe('-1023 B')
  })

  it('handles non-finite', () => {
    expect(formatBytes(NaN)).toBe('NaN')
    expect(formatBytes(Infinity)).toBe('Infinity')
    expect(formatBytes(-Infinity)).toBe('-Infinity')
  })

  it('formatFileSize is alias of formatBytes', () => {
    expect(formatFileSize(1536)).toBe('1.5 KB')
    expect(formatFileSize).toBe(formatBytes)
  })

  it('very large (TB scale)', () => {
    expect(formatBytes(1024 ** 4)).toBe('1 TB')
  })

  it('exceeds defined units (caps at PB, no roll-over)', () => {
    // 1024^6 / 1024^5 = 1024, so 1024^6 bytes = 1024 PB (we stop unit
    // promotion at PB by design — caller's responsibility to interpret).
    const n = 1024 ** 6
    expect(formatBytes(n)).toBe('1024 PB')
  })
})
