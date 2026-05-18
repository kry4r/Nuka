// src/core/testing/explorer/L1/noLossyTruncation.ts
//
// Invariant: fixture-declared expectedText must appear in the grid's asciiView.
// Also checks mustContain[] strings (locked spec §4.2, row 6).
// Catches "SlashCard /fork last-item drop" class of missing-render bugs.
//
// Active only when fixtureCase.expectedText or fixtureCase.mustContain is set.

import type { AnsiGrid, InvariantCtx, Violation } from '../types'

export function noLossyTruncation(grid: AnsiGrid, ctx: InvariantCtx): Violation[] {
  const fc = ctx.fixtureCase
  if (!fc) return []

  const violations: Violation[] = []
  const view = grid.asciiView

  // Check expectedText (single string, user-facing shorthand)
  if (fc.expectedText) {
    if (!view.includes(fc.expectedText)) {
      violations.push({
        rule: 'noLossyTruncation',
        severity: 'error',
        message: `Expected text "${fc.expectedText}" not found in rendered output (viewport ${ctx.viewport.cols}×${ctx.viewport.rows})`,
        excerpt: view.slice(0, 120),
      })
    }
  }

  // Check mustContain[] (array form, also used by sweep)
  if (fc.mustContain) {
    for (const needle of fc.mustContain) {
      if (!view.includes(needle)) {
        violations.push({
          rule: 'noLossyTruncation',
          severity: 'error',
          message: `mustContain: "${needle}" not found in rendered output (viewport ${ctx.viewport.cols}×${ctx.viewport.rows})`,
          excerpt: view.slice(0, 120),
        })
      }
    }
  }

  return violations
}
