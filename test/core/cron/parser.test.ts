// test/core/cron/parser.test.ts
import { describe, expect, it } from 'vitest'
import {
  computeNextCronRun,
  cronToHuman,
  nextCronRunMs,
  parseCronExpression,
} from '../../../src/core/cron/parser'

describe('parseCronExpression', () => {
  it('parses the canonical "every 5 minutes" expression', () => {
    const f = parseCronExpression('*/5 * * * *')!
    expect(f).not.toBeNull()
    expect(f.minute).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55])
    expect(f.hour.length).toBe(24)
  })

  it('parses comma-list and range with step', () => {
    const f = parseCronExpression('0,30 0-23/2 * * *')!
    expect(f.minute).toEqual([0, 30])
    expect(f.hour).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22])
  })

  it('normalises 7 as Sunday alias for dayOfWeek', () => {
    const f = parseCronExpression('0 9 * * 7')!
    expect(f.dayOfWeek).toEqual([0])
  })

  it('returns null for wrong field count', () => {
    expect(parseCronExpression('* * * *')).toBeNull()
    expect(parseCronExpression('* * * * * *')).toBeNull()
  })

  it('returns null for out-of-range values', () => {
    expect(parseCronExpression('60 * * * *')).toBeNull() // minute > 59
    expect(parseCronExpression('* 24 * * *')).toBeNull() // hour > 23
    expect(parseCronExpression('* * 32 * *')).toBeNull() // dom > 31
    expect(parseCronExpression('* * * 13 *')).toBeNull() // month > 12
    expect(parseCronExpression('* * * * 8')).toBeNull()  // dow > 7
  })

  it('returns null for inverted range', () => {
    expect(parseCronExpression('10-5 * * * *')).toBeNull()
  })

  it('returns null for non-numeric junk', () => {
    expect(parseCronExpression('foo * * * *')).toBeNull()
  })
})

describe('computeNextCronRun', () => {
  it('rounds up strictly to the next matching minute', () => {
    const fields = parseCronExpression('*/5 * * * *')!
    // 12:03 → next is 12:05
    const from = new Date(2026, 4, 1, 12, 3, 30)
    const next = computeNextCronRun(fields, from)!
    expect(next.getHours()).toBe(12)
    expect(next.getMinutes()).toBe(5)
    expect(next.getSeconds()).toBe(0)
  })

  it('crosses the day boundary correctly', () => {
    const fields = parseCronExpression('0 0 * * *')!
    const from = new Date(2026, 4, 1, 23, 59, 0)
    const next = computeNextCronRun(fields, from)!
    expect(next.getDate()).toBe(2)
    expect(next.getHours()).toBe(0)
    expect(next.getMinutes()).toBe(0)
  })

  it('honors dayOfWeek when dayOfMonth is wildcarded', () => {
    // Every Friday at 09:00
    const fields = parseCronExpression('0 9 * * 5')!
    // Wed May 6 2026 — next Friday is May 8
    const from = new Date(2026, 4, 6, 12, 0, 0)
    const next = computeNextCronRun(fields, from)!
    expect(next.getDay()).toBe(5)
    expect(next.getHours()).toBe(9)
  })

  it('OR-semantics: both dom & dow constrained → either matches', () => {
    // Fires on the 1st of each month OR every Sunday at 12:00
    const fields = parseCronExpression('0 12 1 * 0')!
    // Sat May 2 2026 → next match is Sun May 3 (dow=0)
    const from = new Date(2026, 4, 2, 13, 0, 0)
    const next = computeNextCronRun(fields, from)!
    // 3rd is Sunday, so day=3 dow=0
    expect(next.getDate()).toBe(3)
    expect(next.getDay()).toBe(0)
  })
})

describe('nextCronRunMs', () => {
  it('returns an epoch-ms number for valid expressions', () => {
    const ms = nextCronRunMs('*/5 * * * *', Date.now())
    expect(typeof ms).toBe('number')
    expect(ms!).toBeGreaterThan(Date.now())
  })

  it('returns null for invalid expressions', () => {
    expect(nextCronRunMs('not-a-cron', Date.now())).toBeNull()
  })
})

describe('cronToHuman', () => {
  it('every N minutes', () => {
    expect(cronToHuman('*/5 * * * *')).toBe('Every 5 minutes')
    expect(cronToHuman('*/1 * * * *')).toBe('Every minute')
  })

  it('every hour', () => {
    expect(cronToHuman('0 * * * *')).toBe('Every hour')
    expect(cronToHuman('30 * * * *')).toBe('Every hour at :30')
  })

  it('every N hours', () => {
    expect(cronToHuman('0 */3 * * *')).toBe('Every 3 hours')
  })

  it('daily at specific time', () => {
    expect(cronToHuman('0 9 * * *')).toMatch(/^Every day at .*9.*$/)
  })

  it('weekdays', () => {
    expect(cronToHuman('0 9 * * 1-5')).toMatch(/^Weekdays at /)
  })

  it('falls through to raw expression for unrecognised patterns', () => {
    expect(cronToHuman('5,10,15 9 1,15 * *')).toBe('5,10,15 9 1,15 * *')
  })

  it('returns the raw input on bad field count', () => {
    expect(cronToHuman('* * *')).toBe('* * *')
  })
})
