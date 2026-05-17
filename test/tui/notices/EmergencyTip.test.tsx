// test/tui/notices/EmergencyTip.test.tsx
//
// Turn 14 polish — the legacy `Welcome/notices/EmergencyTip.tsx` was
// removed because it shared the CronMissed `<Static>`-scroll-away bug.
// Its replacement is the persistent BOTTOM-slot `EmergencyTipBanner`
// (see `src/tui/Status/EmergencyTipBanner.tsx`). These tests now exercise
// the banner component instead. Tri-color semantics from the legacy file
// are preserved by `EmergencyTipBanner` and asserted via the structural
// `lastFrame` / `dismissed` checks below.

import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import stripAnsi from 'strip-ansi'
import { EmergencyTipBanner } from '../../../src/tui/Status/EmergencyTipBanner'

describe('EmergencyTipBanner', () => {
  it('renders nothing when tip is null', () => {
    const { lastFrame } = render(<EmergencyTipBanner tip={null} />)
    expect(stripAnsi(lastFrame() ?? '')).toBe('')
  })

  it('renders nothing when tip text is empty', () => {
    const { lastFrame } = render(<EmergencyTipBanner tip={{ tip: '' }} />)
    expect(stripAnsi(lastFrame() ?? '')).toBe('')
  })

  it('renders nothing when dismissed', () => {
    const { lastFrame } = render(
      <EmergencyTipBanner
        tip={{ tip: 'Heads up: cache flushed', color: 'warning' }}
        dismissed
      />,
    )
    expect(stripAnsi(lastFrame() ?? '')).toBe('')
  })

  it('renders the tip text inside a bordered box when present', () => {
    const { lastFrame } = render(
      <EmergencyTipBanner
        tip={{ tip: 'Heads up: cache flushed', color: 'warning' }}
      />,
    )
    const f = stripAnsi(lastFrame() ?? '')
    expect(f).toContain('Heads up: cache flushed')
    // Rounded border characters from `borderStyle="round"` should be present.
    expect(f).toMatch(/[╭╮╰╯]/)
  })

  it('renders nothing by default when tip is omitted', () => {
    const { lastFrame } = render(<EmergencyTipBanner />)
    expect(stripAnsi(lastFrame() ?? '')).toBe('')
  })
})
