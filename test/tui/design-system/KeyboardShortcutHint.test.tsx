// test/tui/design-system/KeyboardShortcutHint.test.tsx
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import stripAnsi from 'strip-ansi'
import { KeyboardShortcutHint } from '../../../src/tui/design-system/KeyboardShortcutHint'

describe('KeyboardShortcutHint', () => {
  it('renders "<shortcut> to <action>"', () => {
    const { lastFrame } = render(
      <KeyboardShortcutHint shortcut="Esc" action="cancel" />,
    )
    expect(stripAnsi(lastFrame() ?? '')).toContain('Esc to cancel')
  })

  it('wraps in parens when parens prop is set', () => {
    const { lastFrame } = render(
      <KeyboardShortcutHint shortcut="ctrl+o" action="expand" parens />,
    )
    expect(stripAnsi(lastFrame() ?? '')).toContain('(ctrl+o to expand)')
  })

  it('renders bold shortcut when bold is set', () => {
    const { lastFrame } = render(
      <KeyboardShortcutHint shortcut="Enter" action="confirm" bold />,
    )
    expect(stripAnsi(lastFrame() ?? '')).toContain('Enter to confirm')
  })
})
