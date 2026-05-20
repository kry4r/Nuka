// test/core/testing/explorer/L0/grid.test.ts
//
// M1.T2 — AnsiGrid.parse + staticTap tests (RED until impl complete)

import { describe, it, expect } from 'vitest'
import React from 'react'
import { Text, Static, useCursor } from 'ink'

import { AnsiGrid } from '../../../../../src/core/testing/explorer/L0/grid'
import { renderWithViewport } from '../../../../../src/core/testing/explorer/L0/render'
import { FakeStdout } from '../../../../../src/core/testing/explorer/L0/viewport'

// Will fail until staticTap.ts is created
import { staticTap } from '../../../../../src/core/testing/explorer/L0/staticTap'

describe('AnsiGrid.parse', () => {
  it('ASCII grid of plain text matches asciiView byte-for-byte after stripping ANSI', () => {
    const text = 'hello world'
    // Parse a plain-text string (no ANSI codes) at cols=20, rows=3
    const grid = AnsiGrid.parse(text, { cols: 20, rows: 3 })
    // First row of asciiView should start with 'hello world'
    const firstLine = grid.asciiView.split('\n')[0] ?? ''
    expect(firstLine.trimEnd()).toMatch(/^hello world/)
    // asciiView lines should each be exactly 20 chars
    for (const line of grid.asciiView.split('\n')) {
      expect(line.length).toBe(20)
    }
  })

  it('detects a single box-drawing rectangle with correct (x, y, w, h)', () => {
    // Build a simple 5×3 box using box-drawing chars
    //  ┌───┐
    //  │   │
    //  └───┘
    const box = '┌───┐\n│   │\n└───┘'
    const grid = AnsiGrid.parse(box, { cols: 10, rows: 3 })
    expect(grid.boxes.length).toBeGreaterThanOrEqual(1)
    const b = grid.boxes[0]!
    expect(b.x).toBe(0)
    expect(b.y).toBe(0)
    expect(b.w).toBe(5)
    expect(b.h).toBe(3)
  })

  it('CJK glyph occupies 2 cells', () => {
    // 'A' followed by CJK '中' followed by 'B'
    const grid = AnsiGrid.parse('A中B', { cols: 10, rows: 1 })
    // col 0 = 'A' width 1
    expect(grid.cells[0]![0]!.char).toBe('A')
    expect(grid.cells[0]![0]!.width).toBe(1)
    // col 1 = '中' width 2
    expect(grid.cells[0]![1]!.char).toBe('中')
    expect(grid.cells[0]![1]!.width).toBe(2)
    // col 2 = continuation cell (width 0)
    expect(grid.cells[0]![2]!.width).toBe(0)
    // col 3 = 'B'
    expect(grid.cells[0]![3]!.char).toBe('B')
  })

  it('sha256 hash is deterministic across two parses of the same input', () => {
    const text = 'deterministic content'
    const g1 = AnsiGrid.parse(text, { cols: 30, rows: 2 })
    const g2 = AnsiGrid.parse(text, { cols: 30, rows: 2 })
    expect(g1.hash).toBe(g2.hash)
    expect(g1.hash).toMatch(/^[a-f0-9]{64}$/)
  })
})

// ---------------------------------------------------------------------------
// FakeStdout looksLikeRedraw heuristic — regression guard for ESC[G routing.
//
// The `looksLikeRedraw` heuristic in viewport.ts classifies a write as a
// live-frame rerender (→ liveBuffer) when it contains cursor-positioning
// escapes (ESC[G, ESC[2K, ESC[<n>A …). This guards against a future refactor
// accidentally routing such writes to staticBuffer instead.
//
// Read viewport.ts to understand the classifier:
//   * `looksLikeRedraw = CURSOR_MOVE_RE.test(str)` where
//     CURSOR_MOVE_RE = /\u001b\[(?:\d*[ABCDGJKfH]|\d*;\d*[fH]|2K)/
//   * A mixed write (cursor-positioning + printable) → liveBuffer always.
//   * A plain-text write during _beforeCursorHide=true → staticBuffer.
// ---------------------------------------------------------------------------
describe('FakeStdout — looksLikeRedraw routing', () => {
  it('plain-text write during BSR transaction (_beforeCursorHide) lands in staticBuffer', () => {
    const stdout = new FakeStdout(40, 10)
    // Open BSR transaction → _beforeCursorHide = true
    stdout.write('\u001b[?2026h')
    // Plain-text write (no cursor-positioning escapes) → should go to staticBuffer
    stdout.write('hello static\n')
    expect(stdout.staticBuffer).toContain('hello static')
    expect(stdout.liveBuffer).toBe('')
  })

  it('write containing ESC[G (cursor-to-col-1) + content routes to liveBuffer, not staticBuffer', () => {
    // This is the looksLikeRedraw regression test. ink emits ESC[G as part of
    // its in-place rerender path (e.g., "[2K[1A[2K[GBROKEN\n"). Even during a
    // BSR transaction (_beforeCursorHide=true), the ESC[G mixed write must
    // land in liveBuffer — not staticBuffer — because the classifier correctly
    // identifies it as a live-frame redraw.
    const stdout = new FakeStdout(40, 10)
    // Open BSR transaction → _beforeCursorHide = true
    stdout.write('\u001b[?2026h')
    // Mixed write: cursor-to-col-1 (ESC[G) + printable content
    stdout.write('\u001b[GBROKEN-CONTENT\n')
    // looksLikeRedraw=true → liveBuffer, NOT staticBuffer
    expect(stdout.liveBuffer).toContain('BROKEN-CONTENT')
    expect(stdout.staticBuffer).not.toContain('BROKEN-CONTENT')
  })

  it('records positioned native cursor show escapes', () => {
    const stdout = new FakeStdout(40, 10)
    stdout.write('\u001b[3A\u001b[8G\u001b[?25h')

    expect(stdout.cursorEvents).toEqual([
      expect.objectContaining({
        positioned: true,
        x: 7,
        up: 3,
      }),
    ])
  })
})

function NativeCursorProbe(): React.JSX.Element {
  const { setCursorPosition } = useCursor()
  setCursorPosition({ x: 4, y: 0 })
  return React.createElement(Text, null, 'cursor-probe')
}

describe('staticTap', () => {
  it('segregates Static items into staticBuffer when prologueGoesStatic is true', async () => {
    // Mount a fixture with <Static> content
    const items = [{ id: 'a', text: 'prologue-line' }]
    const node = React.createElement(
      Static as unknown as React.FC<{
        items: { id: string; text: string }[]
        children: (item: { id: string; text: string }) => React.ReactNode
      }>,
      {
        items,
        children: (item: { id: string; text: string }) =>
          React.createElement(Text, { key: item.id }, item.text),
      },
    )
    const handle = renderWithViewport(node, { cols: 40, rows: 10 })
    await new Promise(r => setImmediate(r))
    await new Promise(r => setImmediate(r))

    // staticTap should have collected the prologue line into staticWrites
    staticTap(handle)
    expect(handle.staticWrites().length).toBeGreaterThanOrEqual(1)
    // The live frame must not re-render Static content (it has scrolled off)
    expect(handle.lastFrame() ?? '').not.toContain('prologue-line')
    handle.unmount()
  })

  it('exposes native cursor telemetry from renderWithViewport', async () => {
    const handle = renderWithViewport(
      React.createElement(NativeCursorProbe),
      { cols: 40, rows: 10 },
    )
    await new Promise(r => setImmediate(r))
    await new Promise(r => setImmediate(r))

    expect(handle.cursorTraces()).toContainEqual(
      expect.objectContaining({
        positioned: true,
        x: 4,
      }),
    )
    handle.unmount()
  })
})
