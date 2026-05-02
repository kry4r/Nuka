import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import * as React from 'react'
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
})
