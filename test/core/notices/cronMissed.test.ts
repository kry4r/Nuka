// test/core/notices/cronMissed.test.ts
//
// P1 #5 — unit tests for the pure missed-cron-task formatter.

import { describe, it, expect } from 'vitest'
import { formatCronMissedNotice } from '../../../src/core/notices/cronMissed'

describe('formatCronMissedNotice', () => {
  it('returns null for an empty list', () => {
    expect(formatCronMissedNotice([])).toBeNull()
  })

  it('handles a single missed task with singular grammar', () => {
    const out = formatCronMissedNotice([{ id: 'abc12345' }])
    expect(out).not.toBeNull()
    expect(out!.count).toBe(1)
    expect(out!.text).toContain('1 scheduled task was missed')
    expect(out!.text).toContain('abc12345')
    expect(out!.text).toContain('next scheduled window')
  })

  it('handles multiple missed tasks with plural grammar', () => {
    const out = formatCronMissedNotice([
      { id: 'aaa11111' },
      { id: 'bbb22222' },
      { id: 'ccc33333' },
    ])
    expect(out).not.toBeNull()
    expect(out!.count).toBe(3)
    expect(out!.text).toContain('3 scheduled tasks were missed')
    expect(out!.text).toContain('aaa11111')
    expect(out!.text).toContain('bbb22222')
    expect(out!.text).toContain('ccc33333')
  })

  it('lists IDs in input order separated by commas', () => {
    const out = formatCronMissedNotice([
      { id: 'first000' },
      { id: 'second00' },
    ])
    expect(out!.text).toMatch(/first000, second00/)
  })

  it('does not promise a manual trigger affordance', () => {
    // The cron tools don't expose a manual-trigger command; the wording
    // must not mislead the user into expecting one.
    const out = formatCronMissedNotice([{ id: 'abc' }])
    expect(out!.text.toLowerCase()).not.toContain('manual')
    expect(out!.text.toLowerCase()).not.toContain('trigger')
  })

  it('ignores extra fields on the input (structural typing)', () => {
    // The function should accept any object with an `id: string` — we
    // pass extras to assert that's a structural match and nothing else
    // is read.
    const out = formatCronMissedNotice([
      { id: 'minimal0', cron: '* * * * *', prompt: 'ignored' } as { id: string },
    ])
    expect(out!.text).toContain('minimal0')
    expect(out!.text).not.toContain('* * * * *')
    expect(out!.text).not.toContain('ignored')
  })
})
