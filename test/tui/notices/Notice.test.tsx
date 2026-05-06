// test/tui/notices/Notice.test.tsx
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { Text } from 'ink'
import stripAnsi from 'strip-ansi'
import { Notice } from '../../../src/tui/Welcome/notices/Notice'

describe('Notice', () => {
  it('renders nothing when shouldShow is false', () => {
    const { lastFrame } = render(
      <Notice shouldShow={false}>hidden</Notice>,
    )
    expect(stripAnsi(lastFrame() ?? '')).toBe('')
  })

  it('renders the body when shouldShow is true', () => {
    const { lastFrame } = render(
      <Notice shouldShow>visible content</Notice>,
    )
    expect(stripAnsi(lastFrame() ?? '')).toContain('visible content')
  })

  it('passes a ReactNode through unwrapped', () => {
    const { lastFrame } = render(
      <Notice shouldShow><Text>node child</Text></Notice>,
    )
    expect(stripAnsi(lastFrame() ?? '')).toContain('node child')
  })
})
