// src/core/testing/explorer/fuzz.ts
//
// L3 Fuzz verb — M3 implementation placeholder.
// See locked spec §4.4 for the full design.

import type { FuzzOpts, FuzzResult } from './types'

/**
 * Random stdin + occasional viewport resize, shrunk to minimal repro on
 * failure.
 *
 * @throws {Error} not implemented (M3)
 */
export async function fuzz(_opts: FuzzOpts): Promise<FuzzResult> {
  throw new Error('not implemented (M3)')
}
