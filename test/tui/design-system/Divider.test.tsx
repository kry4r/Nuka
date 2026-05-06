// test/tui/design-system/Divider.test.tsx
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import stripAnsi from 'strip-ansi'
import { Divider } from '../../../src/tui/design-system/Divider'

describe('Divider (rich)', () => {
  it('renders width × ─ when no title', () => {
    const { lastFrame } = render(<Divider width={8} />)
    expect(stripAnsi(lastFrame() ?? '').trim()).toBe('\u2500'.repeat(8))
  })

  it('subtracts padding from width', () => {
    const { lastFrame } = render(<Divider width={10} padding={4} />)
    expect(stripAnsi(lastFrame() ?? '').trim()).toBe('\u2500'.repeat(6))
  })

  it('honours custom char', () => {
    const { lastFrame } = render(<Divider width={5} char="=" />)
    expect(stripAnsi(lastFrame() ?? '').trim()).toBe('====='.toString())
  })

  it('renders title centered with side dashes', () => {
    const { lastFrame } = render(<Divider width={20} title="Updates" />)
    const f = stripAnsi(lastFrame() ?? '')
    expect(f).toContain('Updates')
    // Some dashes must appear on either side of the title.
    expect(f).toMatch(/\u2500+ Updates \u2500+/)
  })

  it('returns empty string for zero effective width', () => {
    const { lastFrame } = render(<Divider width={0} />)
    expect(stripAnsi(lastFrame() ?? '').trim()).toBe('')
  })
})
