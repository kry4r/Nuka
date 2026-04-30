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
})
