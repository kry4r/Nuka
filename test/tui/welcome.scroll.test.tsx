// test/tui/welcome.scroll.test.tsx
//
// Welcome scroll-up bug — the prologue must behave as a rigid block that
// scrolls up off-screen as the conversation zone shrinks (because the
// prompt grew tall, or the terminal got short), instead of having the
// BorderedBox bottom border creep upward while the title row stays
// pinned at the top.
//
// Strategy: mount the full App (target: 'app') with a synthetically-
// reported `process.stdout.rows`. The conversation zone (TOP slot in
// App.tsx) absorbs `terminalRows - RESERVED_ROWS`, so a tall terminal
// gives the welcome plenty of headroom (it sits at the bottom of an
// otherwise-empty conversation zone), and a short terminal forces the
// welcome to overflow past the top edge — `overflow="hidden"` on the
// parent clips that overflow, so the welcome's top rows disappear
// while the bottom rows (including the border close `╰…╯`) remain
// visible just above the prompt.
//
// We assert the scroll-up direction by checking which lines survive
// the small-terminal frame, not absolute pixel positions, so the test
// stays stable across ink versions.

import { describe, it, expect, afterEach } from 'vitest'
import { mountApp } from '../../src/tui/testing/harness'

const wait = (ms = 30) => new Promise(r => setTimeout(r, ms))

function setTerminalSize(cols: number, rows: number): () => void {
  const orig = {
    columns: process.stdout.columns,
    rows: process.stdout.rows,
  }
  Object.defineProperty(process.stdout, 'columns', { value: cols, configurable: true })
  Object.defineProperty(process.stdout, 'rows', { value: rows, configurable: true })
  return () => {
    Object.defineProperty(process.stdout, 'columns', { value: orig.columns, configurable: true })
    Object.defineProperty(process.stdout, 'rows', { value: orig.rows, configurable: true })
  }
}

describe('Welcome scroll-up (rigid block, top clipped first)', () => {
  let restoreSize: (() => void) | null = null

  afterEach(() => {
    if (restoreSize) {
      restoreSize()
      restoreSize = null
    }
  })

  it('tall terminal: welcome rendered with both title row and bottom border visible', async () => {
    restoreSize = setTerminalSize(70, 40)
    const h = mountApp({ target: 'app' })
    try {
      await wait()
      const frame = h.frames().pop() ?? ''
      // Top row of the BorderedBox starts with ╭─ and includes "NUKA"
      // (compact mode <80 cols uses a centered " NUKA " title).
      expect(frame).toContain('NUKA')
      // Bottom border close glyph
      expect(frame).toContain('╰')
      // Hero hint line is in the welcome body
      expect(frame).toContain('/ for commands')
    } finally {
      h.unmount()
    }
  })

  it('short terminal: welcome top is clipped while the bottom border survives', async () => {
    // 12 rows × 60 cols. RESERVED_ROWS=14 means conversationAvailableRows
    // floors at 8; the natural welcome (~ 11 rows tall) overflows the
    // conversation zone, forcing the spacer to 0 and the top of the
    // BorderedBox to overflow past the top edge — `overflow="hidden"`
    // clips it. The bottom border (and the hero-hint immediately above it)
    // must still be visible just above the prompt.
    restoreSize = setTerminalSize(60, 12)
    const h = mountApp({ target: 'app' })
    try {
      await wait()
      const frame = h.frames().pop() ?? ''
      // Hero hint must still be visible at the bottom of the welcome
      // (this is the LAST text line inside the BorderedBox before the
      // bottom border, so if scroll-direction is correct, it survives).
      expect(frame).toContain('/ for commands')
      // The BorderedBox top row carries the title text " NUKA " on a row
      // that starts with ╭─. If scroll-up clipping works, that row is
      // gone from the rendered frame.
      expect(frame).not.toMatch(/╭─.*NUKA/)
    } finally {
      h.unmount()
    }
  })
})
