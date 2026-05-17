import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import * as React from 'react'
import stripAnsi from 'strip-ansi'
import { AwaySummaryCard } from '../../../src/tui/Recap/AwaySummaryCard'

describe('AwaySummaryCard', () => {
  it('renders text in 1-3 sentences', () => {
    const out = render(
      <AwaySummaryCard
        text="You were refactoring the registry. Next: fix the type error in line 42."
        onDismiss={() => {}}
      />
    ).lastFrame() ?? ''
    expect(out).toContain('refactoring')
    // P2 #44 — the misleading "[esc] dismiss" line was removed (no useInput
    // handler ever fulfilled it). The header chip "While you were away" is
    // the durable UX contract; assert against that instead.
    expect(out.toLowerCase()).toContain('away')
  })

  it('renders while you were away notice', () => {
    const out = render(
      <AwaySummaryCard text="Debugging the auth flow." onDismiss={() => {}} />
    ).lastFrame() ?? ''
    expect(out.toLowerCase()).toContain('away')
  })

  // ─── Iter NNNN — idleMs duration badge ──────────────────────────────

  it('renders a duration badge when idleMs is supplied', () => {
    const out = render(
      <AwaySummaryCard
        text="Recap text."
        onDismiss={() => {}}
        idleMs={47 * 60 * 1000}
      />,
    ).lastFrame() ?? ''
    const clean = stripAnsi(out)
    // formatDuration({precision: 1, subSecondPrecision: false}) for 47m → '47m'
    expect(clean).toContain('47m')
    expect(clean.toLowerCase()).toContain('away')
  })

  it('omits the duration badge when idleMs is missing', () => {
    const out = render(
      <AwaySummaryCard text="Recap text." onDismiss={() => {}} />,
    ).lastFrame() ?? ''
    const clean = stripAnsi(out)
    // The header should not have a "·" separator (the duration follows it).
    expect(clean).not.toContain('·')
  })

  it('omits the duration badge when idleMs is zero or negative', () => {
    const out = render(
      <AwaySummaryCard text="Recap text." onDismiss={() => {}} idleMs={0} />,
    ).lastFrame() ?? ''
    const clean = stripAnsi(out)
    expect(clean).not.toContain('·')
  })
})

