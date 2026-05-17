// test/core/memdir/memoryAge.test.ts
//
// Boundary coverage for the freshness helpers ported from upstream
// Nuka-Code in Issue #9. Each function is small but the contract
// matters: the 0/1/N day boundaries are exactly where the prompts and
// system-reminder wrappers downstream branch their behavior.

import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  memoryAge,
  memoryAgeDays,
  memoryFreshnessNote,
  memoryFreshnessText,
} from '../../../src/core/memdir/memoryAge'

const DAY_MS = 86_400_000

describe('memdir memoryAge', () => {
  const NOW = new Date('2026-05-17T12:00:00Z').getTime()

  afterEach(() => {
    vi.useRealTimers()
  })

  function freezeNow(): void {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
  }

  // ── memoryAgeDays ────────────────────────────────────────────

  it('memoryAgeDays returns 0 for today', () => {
    freezeNow()
    expect(memoryAgeDays(NOW)).toBe(0)
    expect(memoryAgeDays(NOW - 1_000)).toBe(0)
    expect(memoryAgeDays(NOW - (DAY_MS - 1))).toBe(0)
  })

  it('memoryAgeDays returns 1 at the 1-day boundary', () => {
    freezeNow()
    expect(memoryAgeDays(NOW - DAY_MS)).toBe(1)
    expect(memoryAgeDays(NOW - (DAY_MS + 1))).toBe(1)
  })

  it('memoryAgeDays clamps future timestamps to 0', () => {
    freezeNow()
    // Clock skew: mtime in the future. Negative durations must not
    // produce a negative day count.
    expect(memoryAgeDays(NOW + DAY_MS)).toBe(0)
    expect(memoryAgeDays(NOW + 60 * DAY_MS)).toBe(0)
  })

  it('memoryAgeDays floor-rounds large ages', () => {
    freezeNow()
    // 47.5 days → floor to 47.
    expect(memoryAgeDays(NOW - 47.5 * DAY_MS)).toBe(47)
  })

  // ── memoryAge string ─────────────────────────────────────────

  it('memoryAge returns "today" / "yesterday" / "N days ago"', () => {
    freezeNow()
    expect(memoryAge(NOW)).toBe('today')
    expect(memoryAge(NOW - DAY_MS)).toBe('yesterday')
    expect(memoryAge(NOW - 5 * DAY_MS)).toBe('5 days ago')
    expect(memoryAge(NOW - 365 * DAY_MS)).toBe('365 days ago')
  })

  // ── memoryFreshnessText ─────────────────────────────────────

  it('memoryFreshnessText returns "" for today and yesterday', () => {
    freezeNow()
    expect(memoryFreshnessText(NOW)).toBe('')
    expect(memoryFreshnessText(NOW - DAY_MS)).toBe('')
  })

  it('memoryFreshnessText warns starting at 2 days', () => {
    freezeNow()
    const t = memoryFreshnessText(NOW - 2 * DAY_MS)
    expect(t).toContain('This memory is 2 days old.')
    expect(t).toContain('Verify against current code')
  })

  it('memoryFreshnessText embeds the day count', () => {
    freezeNow()
    expect(memoryFreshnessText(NOW - 47 * DAY_MS)).toContain('47 days old')
  })

  // ── memoryFreshnessNote (system-reminder wrapper) ───────────

  it('memoryFreshnessNote returns "" when freshness text is empty', () => {
    freezeNow()
    expect(memoryFreshnessNote(NOW)).toBe('')
    expect(memoryFreshnessNote(NOW - DAY_MS)).toBe('')
  })

  it('memoryFreshnessNote wraps in <system-reminder> for stale entries', () => {
    freezeNow()
    const note = memoryFreshnessNote(NOW - 3 * DAY_MS)
    expect(note.startsWith('<system-reminder>')).toBe(true)
    expect(note.trimEnd().endsWith('</system-reminder>')).toBe(true)
    expect(note).toContain('3 days old')
    // Trailing newline so callers can splice the note directly above
    // memory content without a manual `\n`.
    expect(note.endsWith('\n')).toBe(true)
  })
})
