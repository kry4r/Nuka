// test/core/testing/explorer/L1/invariants.test.ts
//
// M1.T3 — L1 invariant truth-table tests (RED until impl lands)
// 4 pass cases + 4 fail cases = 8 tests

import { describe, it, expect } from 'vitest'
import React from 'react'
import { Box, Text } from 'ink'

import { AnsiGrid } from '../../../../../src/core/testing/explorer/L0/grid'
import { renderWithViewport } from '../../../../../src/core/testing/explorer/L0/render'
// Will fail until L1/index.ts is created
import { invariants, runAll } from '../../../../../src/core/testing/explorer/L1/index'
import type { InvariantCtx } from '../../../../../src/core/testing/explorer/types'

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------
const vp = { cols: 40, rows: 10 }
const ctx = (overrides?: Partial<InvariantCtx>): InvariantCtx => ({
  viewport: vp,
  staticWrites: [],
  ...overrides,
})

// -------------------------------------------------------------------------
// noContentBeyondColumns
// -------------------------------------------------------------------------
describe('noContentBeyondColumns', () => {
  it('PASS: text fits within 40 cols', () => {
    const text = 'x'.repeat(39)
    const grid = AnsiGrid.parse(text, vp)
    const violations = invariants.noContentBeyondColumns(grid, ctx())
    expect(violations).toHaveLength(0)
  })

  it('FAIL: text exceeds 40 cols (line of 45 chars)', () => {
    // Build a string where the plain-text is 45 chars but all on one line
    // We directly inject a long line into asciiView by creating a grid with
    // a text that wraps — but the invariant checks logical lines ≥ cols
    // We fake it: override the grid's asciiView with an overlong line
    const grid = AnsiGrid.parse('y'.repeat(45), { cols: 40, rows: 5 })
    // The invariant should fire because the raw input line had width > cols
    // noContentBeyondColumns checks: any cell column index ≥ cols
    // With cols=40 and 45 chars, the parser wraps — but we can construct
    // a grid with a direct cell at col 40 to trigger the invariant.
    // Instead: test with a narrower viewport so wrapping doesn't occur
    const narrowGrid = AnsiGrid.parse('y'.repeat(45), { cols: 100, rows: 5 })
    // Force a violation by checking against cols=40 but using narrowGrid (cols=100)
    const overrideCtx: InvariantCtx = { viewport: { cols: 40, rows: 5 }, staticWrites: [] }
    const violations = invariants.noContentBeyondColumns(narrowGrid, overrideCtx)
    expect(violations.length).toBeGreaterThan(0)
    expect(violations[0]!.rule).toBe('noContentBeyondColumns')
  })
})

// -------------------------------------------------------------------------
// noBorderBleed
// -------------------------------------------------------------------------
describe('noBorderBleed', () => {
  it('PASS: clean box has no border bleed', () => {
    const box = '┌───┐\n│   │\n└───┘'
    const grid = AnsiGrid.parse(box, { cols: 10, rows: 3 })
    const violations = invariants.noBorderBleed(grid, ctx({ viewport: { cols: 10, rows: 3 } }))
    expect(violations).toHaveLength(0)
  })

  it('FAIL: box perimeter cell replaced by non-box char', () => {
    // Build a box where the right border is replaced by 'X'
    const bleed = '┌───┐\n│   X\n└───┘'
    const grid = AnsiGrid.parse(bleed, { cols: 10, rows: 3 })
    const violations = invariants.noBorderBleed(grid, ctx({ viewport: { cols: 10, rows: 3 } }))
    expect(violations.length).toBeGreaterThan(0)
    expect(violations[0]!.rule).toBe('noBorderBleed')
  })
})

// -------------------------------------------------------------------------
// noStaticWrites
// -------------------------------------------------------------------------
describe('noStaticWrites', () => {
  it('PASS: no static writes', () => {
    const grid = AnsiGrid.parse('clean', vp)
    const violations = invariants.noStaticWrites(grid, ctx({ staticWrites: [] }))
    expect(violations).toHaveLength(0)
  })

  it('FAIL: static writes present without allowStatic', () => {
    const grid = AnsiGrid.parse('clean', vp)
    const violations = invariants.noStaticWrites(grid, ctx({
      staticWrites: ['prologue-line'],
      fixtureCase: { render: () => React.createElement(Text, null, '') /* allowStatic: not set */ },
    }))
    expect(violations.length).toBeGreaterThan(0)
    expect(violations[0]!.rule).toBe('noStaticWrites')
  })
})

// -------------------------------------------------------------------------
// flexGrowBounded — reproduces "Welcome hero contentHeight uncapped"
// Mount <Box flexGrow={1}> at rows=100; outer box must not exceed rows
// -------------------------------------------------------------------------
describe('flexGrowBounded', () => {
  it('PASS: Box height ≤ viewport rows (normal sized)', async () => {
    const handle = renderWithViewport(
      React.createElement(Box, { flexDirection: 'column' },
        React.createElement(Text, null, 'content')
      ),
      { cols: 40, rows: 10 }
    )
    await new Promise(r => setImmediate(r))
    const grid = handle.grid()
    const violations = invariants.flexGrowBounded(grid, ctx())
    expect(violations).toHaveLength(0)
    handle.unmount()
  })

  it('FAIL: flexGrow=1 Box inflates beyond rows=10 (uncapped height)', async () => {
    // This reproduces "Welcome hero contentHeight uncapped":
    // A <Box flexGrow={1}> at rows=100 claims the full 100 rows.
    // The invariant fires because the detected box height > viewport.rows
    // when the test uses a mismatched ctx viewport.
    const handle = renderWithViewport(
      React.createElement(Box, { flexGrow: 1 },
        React.createElement(Text, null, 'hero')
      ),
      { cols: 40, rows: 100 }
    )
    await new Promise(r => setImmediate(r))
    const grid = handle.grid()
    // Check against a viewport of rows=10 — the box inflates to 100 > 10
    const smallCtx: InvariantCtx = {
      viewport: { cols: 40, rows: 10 },
      staticWrites: [],
      fixtureCase: { render: () => React.createElement(Text, null, '') },
    }
    const violations = invariants.flexGrowBounded(grid, smallCtx)
    expect(violations.length).toBeGreaterThan(0)
    expect(violations[0]!.rule).toBe('flexGrowBounded')
    handle.unmount()
  })
})
