// test/tui/design-system/Ratchet.test.tsx
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { Text } from 'ink'
import stripAnsi from 'strip-ansi'
import { Ratchet } from '../../../src/tui/design-system/Ratchet'

function rows(out: string | undefined): string[] {
  return stripAnsi(out ?? '').split('\n')
}

describe('Ratchet', () => {
  it('renders children content', () => {
    const { lastFrame } = render(
      <Ratchet><Text>only</Text></Ratchet>,
    )
    expect(stripAnsi(lastFrame() ?? '')).toContain('only')
  })

  it('initial render has no minHeight enforced beyond actual content', () => {
    // First render: maxHeight starts at 0, so the outer Box has minHeight=undefined
    // and only renders as tall as its actual content.
    const { lastFrame } = render(
      <Ratchet><Text>line a</Text></Ratchet>,
    )
    const lines = rows(lastFrame()).filter(l => l.length > 0)
    // Single Text child → just the one line (plus possibly trailing newline).
    expect(lines.length).toBeLessThanOrEqual(2)
    expect(lines.join('\n')).toContain('line a')
  })

  it('keeps minHeight at the tallest observed height when content shrinks', () => {
    function Tall() {
      return (
        <>
          <Text>row 1</Text>
          <Text>row 2</Text>
          <Text>row 3</Text>
        </>
      )
    }
    function Short() {
      return <Text>only one</Text>
    }
    const { lastFrame, rerender } = render(
      <Ratchet><Tall /></Ratchet>,
    )
    const tallRows = rows(lastFrame()).filter(l => l.length > 0)
    expect(tallRows.length).toBeGreaterThanOrEqual(3)
    // Now rerender with shorter content — Ratchet should hold the height.
    rerender(<Ratchet><Short /></Ratchet>)
    const heldRows = rows(lastFrame())
    // Outer minHeight is locked at the previous max (3 rows) → frame still
    // contains at least 3 lines worth of vertical space.
    expect(heldRows.length).toBeGreaterThanOrEqual(3)
    expect(heldRows.join('\n')).toContain('only one')
  })

  it('grows minHeight when subsequent renders are taller', () => {
    function Two() {
      return (
        <>
          <Text>a</Text><Text>b</Text>
        </>
      )
    }
    function Five() {
      return (
        <>
          <Text>a</Text><Text>b</Text><Text>c</Text><Text>d</Text><Text>e</Text>
        </>
      )
    }
    const { lastFrame, rerender } = render(<Ratchet><Two /></Ratchet>)
    const before = rows(lastFrame()).filter(l => l.length > 0).length
    rerender(<Ratchet><Five /></Ratchet>)
    const after = rows(lastFrame()).filter(l => l.length > 0).length
    expect(after).toBeGreaterThan(before)
  })

  it('does not throw when lock="offscreen" (warns and falls back)', () => {
    // Suppress the deliberate console.warn under test.
    const orig = console.warn
    console.warn = () => {}
    try {
      const { lastFrame } = render(
        <Ratchet lock="offscreen"><Text>x</Text></Ratchet>,
      )
      expect(stripAnsi(lastFrame() ?? '')).toContain('x')
    } finally {
      console.warn = orig
    }
  })
})
