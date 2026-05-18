// src/core/testing/explorer/L1/index.ts
//
// L1 — always-on structural invariants.
// See locked spec §4.2 for the full invariant table.
// M1 ships the first 4; noOverlapBetweenZones + noLossyTruncation are M2.

import type { AnsiGrid, InvariantCtx, Violation } from '../types'
import { noContentBeyondColumns } from './noContentBeyondColumns'
import { noBorderBleed } from './noBorderBleed'
import { noStaticWrites } from './noStaticWrites'
import { flexGrowBounded } from './flexGrowBounded'
import { noOverlapBetweenZones } from './noOverlapBetweenZones'
import { noLossyTruncation } from './noLossyTruncation'

export type InvariantFn = (grid: AnsiGrid, ctx: InvariantCtx) => Violation[]

export const invariants: Record<string, InvariantFn> = {
  noContentBeyondColumns,
  noBorderBleed,
  noStaticWrites,
  flexGrowBounded,
  noOverlapBetweenZones,
  noLossyTruncation,
}

/**
 * Run all always-on invariants against the given grid and context.
 * Returns the union of all violations.
 */
export function runAll(grid: AnsiGrid, ctx: InvariantCtx): Violation[] {
  const all: Violation[] = []
  for (const fn of Object.values(invariants)) {
    all.push(...fn(grid, ctx))
  }
  return all
}
