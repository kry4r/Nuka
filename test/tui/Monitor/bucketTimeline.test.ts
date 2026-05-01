// test/tui/Monitor/bucketTimeline.test.ts
import { describe, it, expect } from 'vitest'
import { bucketTimeline } from '../../../src/tui/Monitor/bucketTimeline'

describe('bucketTimeline', () => {
  it('places events into 1-min bins by topic', () => {
    const t0 = 1700000000000             // arbitrary epoch ms aligned to a minute
    const events = [
      { t: t0, topic: 'task' as const }, { t: t0 + 30_000, topic: 'task' as const },
      { t: t0 + 60_000, topic: 'agent' as const },
      { t: t0 + 90_000, topic: 'message' as const },
    ]
    const buckets = bucketTimeline(events, t0, 3)
    expect(buckets.length).toBe(3)
    expect(buckets[0]!.task).toBe(2)
    expect(buckets[1]!.agent).toBe(1)
    expect(buckets[1]!.message).toBe(1)
  })

  it('counts coordination lane events into a separate bucket field (T8.4)', () => {
    const t0 = 1700000000000
    const events = [
      { t: t0, topic: 'coordination' as const },
      { t: t0 + 5_000, topic: 'coordination' as const },
      { t: t0 + 65_000, topic: 'coordination' as const },
      { t: t0 + 70_000, topic: 'harness' as const }, // unrelated harness event
    ]
    const buckets = bucketTimeline(events, t0, 2)
    expect(buckets[0]!.coordination).toBe(2)
    expect(buckets[1]!.coordination).toBe(1)
    expect(buckets[1]!.harness).toBe(1)
    // Existing fields default to 0 when no events on that lane
    expect(buckets[0]!.task).toBe(0)
    expect(buckets[0]!.harness).toBe(0)
  })
})
