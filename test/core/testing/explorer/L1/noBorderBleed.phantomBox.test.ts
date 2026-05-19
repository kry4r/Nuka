// test/core/testing/explorer/L1/noBorderBleed.phantomBox.test.ts
//
// RED-first test: noBorderBleed must NOT flag the phantom narrow Box that
// detectBoxesClean emits when the Welcome screen header reads "╭──" (space
// at col 3 halts the greedy width scan at w=3).
//
// Root cause: from TL corner ╭ at (0,0), the scan walks right and stops at
// w=3 because getChar(0,3)=space.  The three other corners of Box{0,0,3,16}
// happen to be box chars (TR=─, BL=╰, BR=─), so the candidate passes the
// four-corner test.  Its right edge (col 2, rows 1-14) is all spaces.
// Without the verifiedSides guard, noBorderBleed emits 14 right-edge
// violations.  With the guard those violations are suppressed because the
// right side fails the ≥50% box-char interior check.

import { describe, it, expect } from 'vitest'
import { AnsiGrid } from '../../../../../src/core/testing/explorer/L0/grid'
import { noBorderBleed } from '../../../../../src/core/testing/explorer/L1/noBorderBleed'
import type { InvariantCtx } from '../../../../../src/core/testing/explorer/types'

// ---------------------------------------------------------------------------
// Grid construction
//
// Viewport: 100 cols × 30 rows.
// Outer BorderedBox with rounded corners spans cols 0-75, rows 0-15.
//   Row  0  : ╭──<space>…<space>╮  (the space at col 3 stops width scan at w=3)
//   Rows 1-14: │<spaces ×74>│
//   Row  15 : ╰<─ ×74>╯
//   Rows 16-29: (blank)
// Trailing space pads each row to exactly 100 chars.
//
// At HEAD (before the fix):
//   detectBoxesClean sees TL=╭(0,0), scans right, stops at w=3 (col 3 is
//   space), checks TR=─(0,2)✓, scans down left-edge to h=16, checks
//   BL=╰(15,0)✓ BR=─(15,2)✓ → emits phantom Box{x:0,y:0,w:3,h:16}.
//   noBorderBleed then flags col 2 rows 1-14 as right-edge bleeds → FAIL.
//
// After the fix:
//   Box gains verifiedSides.right=false (interior right-edge cells are
//   spaces, <50% box chars).  noBorderBleed skips the right-edge loop for
//   that Box → 0 violations → PASS.
// ---------------------------------------------------------------------------

function buildWelcomeGrid(): string {
  const COLS = 100
  const BOX_COLS = 76   // outer box: col 0 … col 75 (w=76)
  const BOX_ROWS = 16   // outer box: row 0 … row 15 (h=16)
  const TOTAL_ROWS = 30

  const lines: string[] = []

  // Row 0: ╭──<space><spaces…>╮<trailing spaces>
  // The key: col 3 is a SPACE so the greedy width scan from ╭ stops at w=3.
  const topEdge =
    '╭' +                       // col 0 TL corner
    '──' +                      // cols 1-2  (box chars that stop scan)
    ' ' +                       // col 3     (space — halts width scan)
    ' '.repeat(BOX_COLS - 5) +  // cols 4-74 (interior top)
    '╮'                         // col 75    TR corner
  lines.push(topEdge.padEnd(COLS, ' '))

  // Rows 1-14: │<spaces>│
  for (let r = 1; r < BOX_ROWS - 1; r++) {
    const row =
      '│' +
      ' '.repeat(BOX_COLS - 2) +
      '│'
    lines.push(row.padEnd(COLS, ' '))
  }

  // Row 15: ╰<─×74>╯
  const bottomEdge =
    '╰' +
    '─'.repeat(BOX_COLS - 2) +
    '╯'
  lines.push(bottomEdge.padEnd(COLS, ' '))

  // Rows 16-29: blank
  for (let r = BOX_ROWS; r < TOTAL_ROWS; r++) {
    lines.push(' '.repeat(COLS))
  }

  return lines.join('\n')
}

describe('noBorderBleed — phantom narrow Box (Welcome screen regression)', () => {
  it('produces zero violations on the Welcome outer border (no phantom right-edge bleed)', () => {
    const ansiStr = buildWelcomeGrid()
    const viewport = { cols: 100, rows: 30 }
    const grid = AnsiGrid.parse(ansiStr, viewport)
    const ctx: InvariantCtx = { viewport, staticWrites: [] }

    const violations = noBorderBleed(grid, ctx)

    // At HEAD (before fix): detectBoxesClean emits phantom Box{0,0,3,16} and
    // noBorderBleed flags its right edge (col 2, rows 1-14) → 14 violations.
    // After fix: verifiedSides.right=false → right-edge loop skipped → 0.
    expect(violations).toHaveLength(0)
  })
})
