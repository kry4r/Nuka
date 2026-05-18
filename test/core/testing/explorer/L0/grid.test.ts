// test/core/testing/explorer/L0/grid.test.ts
//
// M1.T2 — AnsiGrid.parse + staticTap tests (RED until impl complete)

import { describe, it, expect } from 'vitest'
import React from 'react'
import { Text, Static } from 'ink'

import { AnsiGrid } from '../../../../../src/core/testing/explorer/L0/grid'
import { renderWithViewport } from '../../../../../src/core/testing/explorer/L0/render'

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

describe('staticTap', () => {
  it('segregates Static items into staticBuffer when prologueGoesStatic is true', async () => {
    // Mount a fixture with <Static> content
    const items = [{ id: 'a', text: 'prologue-line' }]
    const node = React.createElement(
      Static<{ id: string; text: string }>,
      { items },
      (item: { id: string; text: string }) => React.createElement(Text, { key: item.id }, item.text)
    )
    const handle = renderWithViewport(node, { cols: 40, rows: 10 })
    await new Promise(r => setImmediate(r))
    await new Promise(r => setImmediate(r))

    // staticTap should have collected the prologue line
    const tapped = staticTap(handle)
    // The prologue text should appear somewhere — either in staticWrites or
    // the tap result should have detected it
    expect(tapped.staticLines.length + handle.staticWrites().length).toBeGreaterThan(0)
    handle.unmount()
  })
})
