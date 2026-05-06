// test/tui/design-system/LoadingState.test.tsx
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import stripAnsi from 'strip-ansi'
import { LoadingState } from '../../../src/tui/design-system/LoadingState'

describe('LoadingState', () => {
  it('renders the message next to the static glyph', () => {
    const { lastFrame } = render(<LoadingState message="Loading sessions" />)
    const f = stripAnsi(lastFrame() ?? '')
    expect(f).toContain('Loading sessions')
    expect(f).toContain('\u2026')
  })

  it('renders a subtitle below the main row when provided', () => {
    const { lastFrame } = render(
      <LoadingState message="Top" subtitle="more details" />,
    )
    const f = stripAnsi(lastFrame() ?? '')
    expect(f).toContain('Top')
    expect(f).toContain('more details')
    const lines = f.split('\n').map(l => l.trim()).filter(Boolean)
    const topIdx = lines.findIndex(l => l.includes('Top'))
    const subIdx = lines.findIndex(l => l.includes('more details'))
    expect(subIdx).toBeGreaterThan(topIdx)
  })
})
