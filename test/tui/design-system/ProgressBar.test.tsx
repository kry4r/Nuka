// test/tui/design-system/ProgressBar.test.tsx
//
// Note on rendered output: ink trims trailing whitespace per row when
// rasterizing, so a bar like `#####     ` reads back as `#####`.  The bar
// is still 10 cells wide on screen (the empty cells are styled with the
// `emptyColor` background); we just can't assert their presence in the
// stripped-ANSI test frame.  Tests below verify the visible non-blank
// portion plus partial-fill boundary behavior.

import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import stripAnsi from 'strip-ansi'
import { ProgressBar } from '../../../src/tui/design-system/ProgressBar'

function frame(out: string | undefined): string {
  return stripAnsi(out ?? '').replace(/\n+$/, '')
}

describe('ProgressBar', () => {
  it('ratio=0, width=10 → no visible fill (all spaces, trimmed by ink)', () => {
    const { lastFrame } = render(<ProgressBar ratio={0} width={10} />)
    expect(frame(lastFrame())).toBe('')
  })

  it('ratio=1, width=8 → all #', () => {
    const { lastFrame } = render(<ProgressBar ratio={1} width={8} />)
    const f = frame(lastFrame())
    expect(f).toBe('#'.repeat(8))
    expect(f.length).toBe(8)
  })

  it('ratio=0.5, width=10 → 5 # visible, trailing empties trimmed', () => {
    const { lastFrame } = render(<ProgressBar ratio={0.5} width={10} />)
    const f = frame(lastFrame())
    // 5 whole fills; partial char at index 5 is BLOCKS[0]=' ' (remainder=0),
    // followed by 4 spaces → trailing whitespace stripped → just the 5 #s.
    expect(f).toBe('#####')
  })

  it('ratio=0.3, width=5 → 1 # then partial-fill char then trimmed empties', () => {
    const { lastFrame } = render(<ProgressBar ratio={0.3} width={5} />)
    const f = frame(lastFrame())
    // whole = floor(1.5) = 1, remainder = 0.5, middle = floor(0.5*9) = 4 → BLOCKS[4]='='
    expect(f).toBe('#=')
  })

  it('clamps ratio < 0 to 0 (no visible fill)', () => {
    const { lastFrame } = render(<ProgressBar ratio={-0.5} width={6} />)
    expect(frame(lastFrame())).toBe('')
  })

  it('clamps ratio > 1 to 1 (all #)', () => {
    const { lastFrame } = render(<ProgressBar ratio={2} width={6} />)
    expect(frame(lastFrame())).toBe('#'.repeat(6))
  })

  it('honours custom fill/empty colors without crashing', () => {
    const { lastFrame } = render(
      <ProgressBar ratio={0.5} width={5} fillColor="red" emptyColor="blue" />,
    )
    // whole=floor(2.5)=2, remainder=0.5, middle=floor(0.5*9)=4 → BLOCKS[4]='='
    const f = frame(lastFrame())
    expect(f).toBe('##=')
  })

  it('high-ratio boundary picks the highest BLOCKS index', () => {
    // ratio=0.99, width=10: whole=9, remainder=0.9, middle=floor(0.9*9)=8 → BLOCKS[8]='#'
    const { lastFrame } = render(<ProgressBar ratio={0.99} width={10} />)
    expect(frame(lastFrame())).toBe('##########')
  })
})
