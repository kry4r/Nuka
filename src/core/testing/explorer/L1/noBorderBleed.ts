// src/core/testing/explorer/L1/noBorderBleed.ts
//
// Invariant: for each detected Box, all perimeter cells must remain
// box-drawing characters.  Catches StatusPanel column bleed.
// See locked spec §4.2.

import type { AnsiGrid, InvariantCtx, Violation } from '../types'

// Box-drawing character range U+2500–U+257F
function isBoxChar(ch: string): boolean {
  if (!ch || ch.length === 0) return false
  const cp = ch.codePointAt(0) ?? 0
  return cp >= 0x2500 && cp <= 0x257f
}

export function noBorderBleed(grid: AnsiGrid, ctx: InvariantCtx): Violation[] {
  void ctx  // ctx used for future zone checks; not needed here
  const violations: Violation[] = []

  for (const box of grid.boxes) {
    const { x, y, w, h } = box

    // Check top and bottom edges
    for (let c = x; c < x + w; c++) {
      const top = grid.cells[y]?.[c]?.char ?? ''
      const bot = grid.cells[y + h - 1]?.[c]?.char ?? ''
      if (!isBoxChar(top)) {
        violations.push({
          rule: 'noBorderBleed',
          severity: 'error',
          cells: [{ x: c, y }],
          excerpt: top || ' ',
          message: `Border bleed at top edge (${c},${y}): '${top}' is not a box char`,
        })
      }
      if (h > 1 && !isBoxChar(bot)) {
        violations.push({
          rule: 'noBorderBleed',
          severity: 'error',
          cells: [{ x: c, y: y + h - 1 }],
          excerpt: bot || ' ',
          message: `Border bleed at bottom edge (${c},${y + h - 1}): '${bot}' is not a box char`,
        })
      }
    }

    // Check left and right edges (excluding corners already checked)
    for (let r = y + 1; r < y + h - 1; r++) {
      const left  = grid.cells[r]?.[x]?.char ?? ''
      const right = grid.cells[r]?.[x + w - 1]?.char ?? ''
      if (!isBoxChar(left)) {
        violations.push({
          rule: 'noBorderBleed',
          severity: 'error',
          cells: [{ x, y: r }],
          excerpt: left || ' ',
          message: `Border bleed at left edge (${x},${r}): '${left}' is not a box char`,
        })
      }
      if (w > 1 && !isBoxChar(right)) {
        violations.push({
          rule: 'noBorderBleed',
          severity: 'error',
          cells: [{ x: x + w - 1, y: r }],
          excerpt: right || ' ',
          message: `Border bleed at right edge (${x + w - 1},${r}): '${right}' is not a box char`,
        })
      }
    }
  }

  return violations
}
