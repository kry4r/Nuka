// src/core/testing/explorer/sweep/viewportMatrix.ts
//
// Bringup §6 — canonical 7-profile viewport matrix used by sweep.
// Values are verbatim from the spec table; adding profiles is a 1-line change.

import type { Viewport } from '../types'

/** Named viewport profile as used by the sweep verb. */
export type ViewportProfile = Viewport & { name: string }

/**
 * The 7 default viewport profiles from bringup §6.
 * The `sweep` verb runs every fixture against all profiles unless the fixture
 * declares a `viewports` override.
 */
export const VIEWPORT_PROFILES: ViewportProfile[] = [
  { name: 'narrow-compact', cols: 60, rows: 30 },
  { name: 'narrow-edge', cols: 70, rows: 30 },
  { name: 'pre-normal', cols: 79, rows: 24 },
  { name: 'normal', cols: 100, rows: 30 },
  { name: 'normal-tall', cols: 100, rows: 50 },
  { name: 'wide', cols: 120, rows: 30 },
  { name: 'wide-tall', cols: 140, rows: 60 },
]
