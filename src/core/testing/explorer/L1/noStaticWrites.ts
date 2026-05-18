// src/core/testing/explorer/L1/noStaticWrites.ts
//
// Invariant: staticWrites().length === 0 unless fixture sets allowStatic:true.
// Catches Messages <Static> regression (locked spec §4.2).
//
// Anchors: Messages.tsx:168 prologueGoesStatic — when this flips true the
// prologue goes into the staticBuffer; this invariant fires unless the fixture
// opts out with allowStatic:true.

import type { AnsiGrid, InvariantCtx, Violation } from '../types'

export function noStaticWrites(grid: AnsiGrid, ctx: InvariantCtx): Violation[] {
  void grid  // invariant does not inspect cells
  if (ctx.fixtureCase?.allowStatic) return []

  const lines = ctx.staticWrites.filter(l => l.trim().length > 0)
  if (lines.length === 0) return []

  return [{
    rule: 'noStaticWrites',
    severity: 'error',
    excerpt: lines.slice(0, 3).join(' | '),
    message: `${lines.length} unexpected Static write(s) detected. ` +
      `Set allowStatic:true on the fixture if intentional.`,
  }]
}
