// test/tui/notices/EmergencyTip.test.tsx
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import stripAnsi from 'strip-ansi'
import { EmergencyTip } from '../../../src/tui/Welcome/notices/EmergencyTip'

describe('EmergencyTip', () => {
  it('renders nothing when tip is null', () => {
    const { lastFrame } = render(<EmergencyTip tip={null} />)
    expect(stripAnsi(lastFrame() ?? '')).toBe('')
  })

  it('renders nothing when tip text is empty', () => {
    const { lastFrame } = render(<EmergencyTip tip={{ tip: '' }} />)
    expect(stripAnsi(lastFrame() ?? '')).toBe('')
  })

  it('renders the tip text indented when present', () => {
    const { lastFrame } = render(
      <EmergencyTip tip={{ tip: 'Heads up: cache flushed', color: 'warning' }} />,
    )
    const f = stripAnsi(lastFrame() ?? '')
    expect(f).toContain('Heads up: cache flushed')
    // 2-col indent
    expect(f.split('\n').some(l => l.startsWith('  '))).toBe(true)
  })

  it('reads from getEmergencyTip when no prop is given (default null)', () => {
    const { lastFrame } = render(<EmergencyTip />)
    expect(stripAnsi(lastFrame() ?? '')).toBe('')
  })
})
