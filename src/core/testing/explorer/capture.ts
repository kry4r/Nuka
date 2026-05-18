// src/core/testing/explorer/capture.ts
//
// L0 Capture verb — M1 implementation placeholder.
// See locked spec §4.1 for the full design.

import type { CaptureOpts, CaptureResult } from './types'

/**
 * Mount a single fixture at one viewport and write the ASCII grid + grid JSON
 * to `.ink-explorer/captures/`.
 *
 * @throws {Error} not implemented (M1)
 */
export async function capture(_opts: CaptureOpts): Promise<CaptureResult> {
  throw new Error('not implemented (M1)')
}
