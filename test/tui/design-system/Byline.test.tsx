// test/tui/design-system/Byline.test.tsx
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { Text } from 'ink'
import stripAnsi from 'strip-ansi'
import { Byline } from '../../../src/tui/design-system/Byline'

describe('Byline', () => {
  it('renders nothing when no children', () => {
    const { lastFrame } = render(<Byline>{null}</Byline>)
    expect(stripAnsi(lastFrame() ?? '')).toBe('')
  })

  it('joins multiple items with " | "', () => {
    const { lastFrame } = render(
      <Byline>
        <Text>one</Text>
        <Text>two</Text>
        <Text>three</Text>
      </Byline>,
    )
    const f = stripAnsi(lastFrame() ?? '')
    expect(f).toContain('one')
    expect(f).toContain('two')
    expect(f).toContain('three')
    // Two separators for three items.
    expect(f.match(/\|/g)?.length).toBe(2)
  })

  it('skips no separator when only one valid child', () => {
    const { lastFrame } = render(
      <Byline>
        {false}
        <Text>solo</Text>
        {null}
      </Byline>,
    )
    const f = stripAnsi(lastFrame() ?? '')
    expect(f).toContain('solo')
    expect(f).not.toContain('|')
  })
})
