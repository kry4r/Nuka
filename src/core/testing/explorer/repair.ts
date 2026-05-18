// src/core/testing/explorer/repair.ts
//
// L4 Repair verb — M5 implementation placeholder.
// See locked spec §4.6 for the full design.

import type { RepairOpts, RepairResult } from './types'

/**
 * Spawn Opus subagent to read a failure dump, propose edits, verify, and
 * promote a regression fixture.
 *
 * @throws {Error} not implemented (M5)
 */
export async function repair(_opts: RepairOpts): Promise<RepairResult> {
  throw new Error('not implemented (M5)')
}
