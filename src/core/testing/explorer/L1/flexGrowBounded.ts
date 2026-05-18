// src/core/testing/explorer/L1/flexGrowBounded.ts
//
// Invariant: for any detected outer Box (box-drawing rectangle), its height
// must be ≤ viewport.rows.  Additionally, the grid's actual row count
// (grid.rows) must not exceed viewport.rows — this catches "Welcome hero
// contentHeight uncapped" where flexGrow=1 inflates the component to the
// full rows of the FakeStdout, which can be >> the intended viewport.
// See locked spec §4.2.
//
// Minimal repro: mount <Box flexGrow={1}> at rows=100, check against ctx
// viewport rows=10 → grid.rows(100) > ctx.viewport.rows(10) → violation.

import type { AnsiGrid, InvariantCtx, Violation } from '../types'

export function flexGrowBounded(grid: AnsiGrid, ctx: InvariantCtx): Violation[] {
  const maxH = ctx.viewport.rows
  const violations: Violation[] = []

  // Check detected box-drawing rectangles
  for (const box of grid.boxes) {
    if (box.h > maxH) {
      violations.push({
        rule: 'flexGrowBounded',
        severity: 'error',
        cells: [{ x: box.x, y: box.y }],
        excerpt: `box(x=${box.x},y=${box.y},w=${box.w},h=${box.h})`,
        message: `Box height ${box.h} exceeds viewport rows ${maxH} — ` +
          `likely uncapped flexGrow=1 layout`,
      })
    }
  }

  // Check grid.rows vs ctx.viewport.rows — catches flexGrow inflation even
  // without box-drawing borders (e.g. <Box flexGrow={1}> with plain text).
  // grid.rows = FakeStdout.rows at render time; ctx.viewport.rows = intended.
  if (grid.rows > maxH) {
    violations.push({
      rule: 'flexGrowBounded',
      severity: 'error',
      cells: [{ x: 0, y: maxH }],
      excerpt: `grid.rows=${grid.rows}`,
      message: `Rendered grid rows ${grid.rows} exceeds viewport rows ${maxH} — ` +
        `flexGrow=1 layout may be uncapped`,
    })
  }

  // For components that declare expectsHugContent, relax and only warn if
  // content height exceeds rows + 1
  if (ctx.fixtureCase?.expectsHugContent) {
    const nonEmptyRows = grid.asciiView.split('\n')
      .filter(l => l.trim().length > 0).length
    if (nonEmptyRows > maxH + 1) {
      violations.push({
        rule: 'flexGrowBounded',
        severity: 'warn',
        message: `Content height ${nonEmptyRows} exceeds viewport rows ${maxH} + 1 ` +
          `(expectsHugContent fixture)`,
      })
    }
  }

  return violations
}
