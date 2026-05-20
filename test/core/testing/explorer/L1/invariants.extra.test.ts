// test/core/testing/explorer/L1/invariants.extra.test.ts
//
// M2.T2 — RED-first tests for noOverlapBetweenZones + noLossyTruncation.
// 2 invariants × (pass + fail) = 4 tests.

import { describe, it, expect } from 'vitest'
import { AnsiGrid } from '../../../../../src/core/testing/explorer/L0/grid'
import { runAll } from '../../../../../src/core/testing/explorer/L1/index'
import type { InvariantCtx, FixtureCase } from '../../../../../src/core/testing/explorer/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const vp = { cols: 40, rows: 10 }
const ctx = (overrides?: Partial<InvariantCtx>): InvariantCtx => ({
  viewport: vp,
  staticWrites: [],
  ...overrides,
})

// Build a minimal AnsiGrid from a raw ASCII string
function grid(asciiView: string) {
  return AnsiGrid.parse(asciiView, vp)
}

// ---------------------------------------------------------------------------
// noOverlapBetweenZones
// ---------------------------------------------------------------------------
describe('noOverlapBetweenZones', () => {
  it('PASS: two non-overlapping zones produce no violations', () => {
    const fixtureCase: FixtureCase = {
      render: () => { throw new Error('not called') },
      zones: {
        header: { x: 0, y: 0, w: 10, h: 2 },
        body:   { x: 0, y: 3, w: 10, h: 5 },
      },
    }
    const g = grid('hello')
    const violations = runAll(g, ctx({ fixtureCase }))
    const zoneViolations = violations.filter(v => v.rule === 'noOverlapBetweenZones')
    expect(zoneViolations).toHaveLength(0)
  })

  it('FAIL: two overlapping zones produce a violation', () => {
    const fixtureCase: FixtureCase = {
      render: () => { throw new Error('not called') },
      zones: {
        // zone A: rows 0-4, cols 0-9
        header: { x: 0, y: 0, w: 10, h: 5 },
        // zone B: rows 3-7, cols 5-14 — overlaps A at (5-9, 3-4)
        body:   { x: 5, y: 3, w: 10, h: 5 },
      },
    }
    const g = grid('hello')
    const violations = runAll(g, ctx({ fixtureCase }))
    const zoneViolations = violations.filter(v => v.rule === 'noOverlapBetweenZones')
    expect(zoneViolations.length).toBeGreaterThan(0)
    expect(zoneViolations[0]?.message).toMatch(/header.*body|body.*header/i)
  })
})

// ---------------------------------------------------------------------------
// noLossyTruncation
// ---------------------------------------------------------------------------
describe('noLossyTruncation', () => {
  it('PASS: expected text is visible in the grid', () => {
    const fixtureCase: FixtureCase = {
      render: () => { throw new Error('not called') },
      mustContain: ['item-1', 'item-2'],
      expectedText: 'item-1',
    }
    // Grid content that includes item-1
    const g = AnsiGrid.parse('item-1\nitem-2\nitem-3', vp)
    const violations = runAll(g, ctx({ fixtureCase }))
    const truncViolations = violations.filter(v => v.rule === 'noLossyTruncation')
    expect(truncViolations).toHaveLength(0)
  })

  it('FAIL: expected text is not visible (viewport cut the last item)', () => {
    // Reproduce the "SlashCard /fork last-item drop" pattern:
    // A 3-item list rendered into a viewport that only shows 2 rows.
    const fixtureCase: FixtureCase = {
      render: () => { throw new Error('not called') },
      // expectedText is what must appear in asciiView
      expectedText: '/fork',
    }
    // Grid is small — only shows first 2 items, /fork is missing
    const tinyVp = { cols: 40, rows: 2 }
    const g = AnsiGrid.parse('/help\n/run', tinyVp)
    const violations = runAll(g, ctx({ viewport: tinyVp, fixtureCase }))
    const truncViolations = violations.filter(v => v.rule === 'noLossyTruncation')
    expect(truncViolations.length).toBeGreaterThan(0)
    expect(truncViolations[0]?.message).toContain('/fork')
  })
})

// ---------------------------------------------------------------------------
// nativeCursorDeclared
// ---------------------------------------------------------------------------
describe('nativeCursorDeclared', () => {
  it('PASS: fixtures without cursor requirement are ignored', () => {
    const fixtureCase: FixtureCase = {
      render: () => { throw new Error('not called') },
    }
    const g = grid('plain output')
    const violations = runAll(g, ctx({ fixtureCase }))
    const cursorViolations = violations.filter(v => v.rule === 'nativeCursorDeclared')
    expect(cursorViolations).toHaveLength(0)
  })

  it('PASS: a required positioned native cursor is accepted', () => {
    const fixtureCase = {
      render: () => { throw new Error('not called') },
      requiresNativeCursor: true,
    } as FixtureCase
    const g = grid('prompt output')
    const violations = runAll(g, ctx({
      fixtureCase,
      cursorTraces: [{ raw: '\u001b[2G\u001b[?25h', positioned: true, x: 1 }],
    } as Partial<InvariantCtx>))
    const cursorViolations = violations.filter(v => v.rule === 'nativeCursorDeclared')
    expect(cursorViolations).toHaveLength(0)
  })

  it('FAIL: a required cursor with no positioned ANSI event is reported', () => {
    const fixtureCase = {
      render: () => { throw new Error('not called') },
      requiresNativeCursor: true,
    } as FixtureCase
    const g = grid('prompt output')
    const violations = runAll(g, ctx({ fixtureCase, cursorTraces: [] } as Partial<InvariantCtx>))
    const cursorViolations = violations.filter(v => v.rule === 'nativeCursorDeclared')
    expect(cursorViolations.length).toBeGreaterThan(0)
    expect(cursorViolations[0]?.message).toMatch(/native terminal cursor/i)
  })
})
