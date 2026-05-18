// src/core/testing/explorer/L3/stdinFuzzer.ts
//
// L3 Fuzz — deterministic stdin fuzzer (M3.T1).
// See locked spec §4.4: charset rules, no raw Ctrl-C, viewport resize.
//
// Design:
//   * mulberry32 PRNG seeded from a 32-bit unsigned int → fully deterministic.
//   * Charset: printable ASCII 0x20–0x7E + a curated set of named escape
//     sequences imported from src/core/testing/keystrokes.ts (Enter, Esc,
//     arrows, Tab, Backspace). Raw Ctrl-C / Ctrl-D / Ctrl-Z are *excluded*
//     because they unmount the ink test harness (locked spec §4.4 charset).
//   * shouldResize(p) draws a uniform float in [0,1) and returns true iff < p.
//   * pickViewport picks a uniform random element from the supplied matrix.

import {
  ENTER,
  ESC,
  UP,
  DOWN,
  LEFT,
  RIGHT,
  TAB,
  BACKSPACE,
} from '../../keystrokes'
import type { Viewport } from '../types'

// ---------------------------------------------------------------------------
// Keystroke type — a raw chunk to write to stdin (matches stdin.write(s)).
// Single printable bytes (e.g. 'a') and multi-byte escape sequences
// (e.g. UP === '\u001B[A') both fit this shape.
// ---------------------------------------------------------------------------
export type Keystroke = string

// ---------------------------------------------------------------------------
// Charset — assembled once at module load.
// Printable ASCII 0x20–0x7E + named escape constants. Banned bytes
// (0x03 / 0x04 / 0x1A) are NEVER added to this table. The charset is exported
// for the shrinker's "minimal repro candidates" pass, should it ever need it.
// ---------------------------------------------------------------------------
export const FUZZ_CHARSET: Keystroke[] = (() => {
  const out: Keystroke[] = []
  for (let code = 0x20; code <= 0x7e; code++) {
    out.push(String.fromCharCode(code))
  }
  // Named escapes — explicitly excludes CTRL_C (0x03) from keystrokes.ts.
  out.push(ENTER, ESC, UP, DOWN, LEFT, RIGHT, TAB, BACKSPACE)
  return out
})()

// ---------------------------------------------------------------------------
// mulberry32 — tiny, fast, well-distributed 32-bit PRNG.
// Returns a uniform float in [0, 1).
// Reference: https://github.com/bryc/code/blob/master/jshash/PRNGs.md#mulberry32
// ---------------------------------------------------------------------------
function makeMulberry32(seed: number): () => number {
  // Force seed into uint32 space; non-int seeds get floored.
  let a = Math.trunc(seed) >>> 0
  return function () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------------------
// StdinFuzzer — public class wired to L3 fuzz.ts.
// All randomness routes through a single PRNG instance so a single seed
// fully determines: key sequence, resize timing, viewport choices.
// ---------------------------------------------------------------------------
export class StdinFuzzer {
  private rand: () => number

  constructor(seed: number) {
    this.rand = makeMulberry32(seed)
  }

  /** Draw the next keystroke uniformly from the bounded charset. */
  nextKey(): Keystroke {
    const idx = Math.floor(this.rand() * FUZZ_CHARSET.length)
    // Math.floor on rand() < 1 guarantees idx in [0, len-1]; defensive clamp.
    const k = FUZZ_CHARSET[Math.min(idx, FUZZ_CHARSET.length - 1)]
    // Charset is statically non-empty; type-narrow for strict mode.
    if (k === undefined) throw new Error('stdinFuzzer: empty charset')
    return k
  }

  /**
   * Return true with probability `p` (clamped to [0,1]).
   * Over 10k draws the empirical rate is within ±0.02 of p.
   */
  shouldResize(p: number): boolean {
    const clamped = Math.max(0, Math.min(1, p))
    return this.rand() < clamped
  }

  /** Pick a uniformly random viewport from a non-empty matrix. */
  pickViewport(matrix: Viewport[]): Viewport {
    if (matrix.length === 0) {
      throw new Error('stdinFuzzer.pickViewport: empty viewport matrix')
    }
    const idx = Math.floor(this.rand() * matrix.length)
    const v = matrix[Math.min(idx, matrix.length - 1)]
    if (v === undefined) throw new Error('stdinFuzzer.pickViewport: index OOB')
    return v
  }
}
