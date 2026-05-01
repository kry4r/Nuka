// test/tui/Monitor/TimelineView.test.tsx
//
// T8.4 — TimelineView renders the coordination lane.
import { describe, it, expect } from 'vitest'
import * as React from 'react'
import { render } from 'ink-testing-library'
import { TimelineView } from '../../../src/tui/Monitor/TimelineView'

describe('TimelineView', () => {
  it('renders without crashing on empty events', () => {
    const out = render(<TimelineView events={[]} />).lastFrame() ?? ''
    // legend should still be present even with empty buckets
    expect(out).toMatch(/coord/i)
  })

  it('renders coordination lane bars when coordination events exist', () => {
    // TimelineView buckets the past 60 minutes aligned to minute boundaries,
    // and renders the most recent 30 buckets. Events in the *current* partial
    // minute fall outside the bucketing window — pick a time ~5 minutes ago so
    // the events reliably land in a rendered bucket.
    const t = Date.now() - 5 * 60_000
    const events = [
      { t, topic: 'coordination' as const },
      { t: t + 1_000, topic: 'coordination' as const },
    ]
    const out = render(<TimelineView events={events} />).lastFrame() ?? ''
    expect(out).toMatch(/coord/i)
    // The bar character used by TimelineView
    expect(out).toContain('▆')
  })
})
