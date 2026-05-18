// src/core/testing/explorer/L1/noContentBeyondColumns.ts
//
// Invariant: every visible cell must be at column index < viewport.cols.
// Catches PromptInput text overrun (locked spec §4.2).

import type { AnsiGrid, InvariantCtx, Violation } from '../types'
import { stringWidth } from '../common/stringWidth'

export function noContentBeyondColumns(grid: AnsiGrid, ctx: InvariantCtx): Violation[] {
  const limit = ctx.viewport.cols
  const violations: Violation[] = []

  // Check asciiView lines — any line whose visible width exceeds limit
  const lines = grid.asciiView.split('\n')
  for (let rowIdx = 0; rowIdx < lines.length; rowIdx++) {
    const line = lines[rowIdx] ?? ''
    const vw = stringWidth(line.trimEnd())
    if (vw > limit) {
      violations.push({
        rule: 'noContentBeyondColumns',
        severity: 'error',
        cells: [{ x: limit, y: rowIdx }],
        excerpt: line.slice(0, Math.min(80, line.length)),
        message: `Row ${rowIdx} has visible width ${vw} > cols ${limit}`,
      })
    }
  }

  // Also check cell grid: any non-space cell at col >= limit
  for (let r = 0; r < grid.rows; r++) {
    for (let c = limit; c < (grid.cells[r]?.length ?? 0); c++) {
      const cell = grid.cells[r]?.[c]
      if (cell && cell.char.trim() !== '') {
        violations.push({
          rule: 'noContentBeyondColumns',
          severity: 'error',
          cells: [{ x: c, y: r }],
          excerpt: cell.char,
          message: `Cell at (${c}, ${r}) is beyond column limit ${limit}`,
        })
        break  // one violation per row is enough
      }
    }
  }

  return violations
}
