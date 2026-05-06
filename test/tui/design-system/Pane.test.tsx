// test/tui/design-system/Pane.test.tsx
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { Text } from 'ink'
import stripAnsi from 'strip-ansi'
import { Pane } from '../../../src/tui/design-system/Pane'

describe('Pane', () => {
  it('renders body content', () => {
    const { lastFrame } = render(
      <Pane><Text>pane body</Text></Pane>,
    )
    expect(stripAnsi(lastFrame() ?? '')).toContain('pane body')
  })

  it('renders a top divider line above the body', () => {
    const { lastFrame } = render(
      <Pane><Text>x</Text></Pane>,
    )
    const lines = stripAnsi(lastFrame() ?? '').split('\n').map(l => l.trim()).filter(Boolean)
    // At least one all-dash line precedes the body row
    const dividerIdx = lines.findIndex(l => /^\u2500+$/.test(l))
    const bodyIdx = lines.findIndex(l => l.includes('x'))
    expect(dividerIdx).toBeGreaterThanOrEqual(0)
    expect(bodyIdx).toBeGreaterThan(dividerIdx)
  })
})
