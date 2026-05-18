// src/core/testing/explorer/L1/noOverlapBetweenZones.ts
//
// Invariant: if fixture declares zones: Record<string, Box>, no two zones
// share a cell in the rendered grid.
// Catches "future regression class" — locked spec §4.2, row 5.

import type { AnsiGrid, InvariantCtx, Violation } from '../types'

/**
 * Check if two axis-aligned rectangles share at least one cell.
 * Rectangles are defined as (x, y, w, h) where x/y are top-left origin.
 */
function zonesOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  // Overlap iff no axis separates them
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  )
}

export function noOverlapBetweenZones(_grid: AnsiGrid, ctx: InvariantCtx): Violation[] {
  const zones = ctx.fixtureCase?.zones
  if (!zones) return []

  const entries = Object.entries(zones)
  if (entries.length < 2) return []

  const violations: Violation[] = []

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [nameA, boxA] = entries[i]!
      const [nameB, boxB] = entries[j]!
      if (zonesOverlap(boxA, boxB)) {
        // Compute the overlap region for cell highlighting
        const ox = Math.max(boxA.x, boxB.x)
        const oy = Math.max(boxA.y, boxB.y)
        const ox2 = Math.min(boxA.x + boxA.w, boxB.x + boxB.w)
        const oy2 = Math.min(boxA.y + boxA.h, boxB.y + boxB.h)
        // list a few cells in the overlap region
        const cells: Array<{ x: number; y: number }> = []
        for (let cy = oy; cy < oy2 && cells.length < 4; cy++) {
          for (let cx = ox; cx < ox2 && cells.length < 4; cx++) {
            cells.push({ x: cx, y: cy })
          }
        }
        violations.push({
          rule: 'noOverlapBetweenZones',
          severity: 'error',
          cells,
          message: `zones "${nameA}" and "${nameB}" overlap at (${ox},${oy})–(${ox2 - 1},${oy2 - 1})`,
        })
      }
    }
  }

  return violations
}
