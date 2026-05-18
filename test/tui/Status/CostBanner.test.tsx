// test/tui/Status/CostBanner.test.tsx
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { CostBanner } from '../../../src/tui/Status/CostBanner'
import { CostTracker } from '../../../src/core/cost/tracker'

describe('CostBanner', () => {
  it('renders nothing when enabled=false', () => {
    const tracker = new CostTracker()
    tracker.record('claude-haiku-4-5', 's1', { input: 100, output: 50 })
    const { lastFrame } = render(
      <CostBanner enabled={false} tracker={tracker} sessionId="s1" model="claude-haiku-4-5" />,
    )
    expect(lastFrame()?.trim() ?? '').toBe('')
  })

  it('renders nothing when the tracker has no entries for this session', () => {
    const tracker = new CostTracker()
    const { lastFrame } = render(
      <CostBanner enabled={true} tracker={tracker} sessionId="empty" model="claude-haiku-4-5" />,
    )
    expect(lastFrame()?.trim() ?? '').toBe('')
  })

  it('renders nothing when tracker is undefined', () => {
    const { lastFrame } = render(
      <CostBanner enabled={true} sessionId="s1" model="claude-haiku-4-5" />,
    )
    expect(lastFrame()?.trim() ?? '').toBe('')
  })

  it('renders the formatted banner line when enabled and entries exist', () => {
    const tracker = new CostTracker()
    tracker.record('claude-haiku-4-5', 's1', { input: 1000, output: 500 })
    const { lastFrame } = render(
      <CostBanner enabled={true} tracker={tracker} sessionId="s1" model="claude-haiku-4-5" />,
    )
    const out = lastFrame() ?? ''
    expect(out).toMatch(/cost/i)
    expect(out).toContain('1k')
  })

  it('renders tokens-only line when model has no pricing', () => {
    const tracker = new CostTracker()
    tracker.record('made-up-model', 's1', { input: 100, output: 50 })
    const { lastFrame } = render(
      <CostBanner enabled={true} tracker={tracker} sessionId="s1" model="made-up-model" />,
    )
    const out = lastFrame() ?? ''
    expect(out).toContain('100')
    expect(out).not.toContain('$')
  })
})
