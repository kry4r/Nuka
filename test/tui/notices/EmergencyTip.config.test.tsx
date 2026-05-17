// test/tui/notices/EmergencyTip.config.test.tsx
//
// Phase D2 — covers the config-driven path: an explicit tip prop (from
// getEmergencyTipFromConfig) renders text and structure.  The legacy
// null-stub path is exercised by EmergencyTip.test.tsx.  ANSI color
// assertions are skipped because ink-testing-library disables chalk;
// the color routing logic is unit-tested via getEmergencyTipFromConfig.
//
// Turn 14 polish — retargeted at `EmergencyTipBanner` after the legacy
// `Welcome/notices/EmergencyTip.tsx` was removed (it shared the
// CronMissed `<Static>`-scroll-away bug). Tri-color semantics
// (warning/error/dim/unset) are preserved by the banner component.

import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import stripAnsi from 'strip-ansi'
import { EmergencyTipBanner } from '../../../src/tui/Status/EmergencyTipBanner'

describe('EmergencyTipBanner — config-driven', () => {
  it('renders the warning-colored tip', () => {
    const { lastFrame } = render(
      <EmergencyTipBanner tip={{ tip: 'maintenance window 22:00 UTC', color: 'warning' }} />,
    )
    const f = stripAnsi(lastFrame() ?? '')
    expect(f).toContain('maintenance window 22:00 UTC')
    // Bordered box from `borderStyle="round"` should produce corner glyphs.
    expect(f).toMatch(/[╭╮╰╯]/)
  })

  it('renders the error-colored tip', () => {
    const { lastFrame } = render(
      <EmergencyTipBanner tip={{ tip: 'service degraded', color: 'error' }} />,
    )
    expect(stripAnsi(lastFrame() ?? '')).toContain('service degraded')
  })

  it('renders the dim tip when color is dim', () => {
    const { lastFrame } = render(
      <EmergencyTipBanner tip={{ tip: 'just so you know', color: 'dim' }} />,
    )
    expect(stripAnsi(lastFrame() ?? '')).toContain('just so you know')
  })

  it('renders dim by default when color is unset', () => {
    const { lastFrame } = render(
      <EmergencyTipBanner tip={{ tip: 'dim by default' }} />,
    )
    expect(stripAnsi(lastFrame() ?? '')).toContain('dim by default')
  })
})
