// test/core/testing/explorer/L3/shrinker.test.ts
//
// M3.T2 — RED-first tests for the PBT-style sequence shrinker.
// See locked spec §4.4 step 3 (binary-search prefix → per-step deletion).
//
// 2 tests:
//   1. correctness: a 200-byte random sequence containing one 'x' shrinks to
//      exactly ['x'] under the synthetic predicate "contains byte 'x'".
//   2. determinism: same input + same predicate → byte-identical output across
//      multiple invocations.

import { describe, it, expect } from 'vitest'
import { shrink } from '../../../../../src/core/testing/explorer/L3/shrinker'

// Deterministic seedable PRNG so the 200-byte input is stable across runs.
function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Build a 200-byte sequence of letters a..z with exactly one 'x' embedded at
// a known position. Predicate: "contains 'x'".
function build200WithSingleX(): string[] {
  const rng = makeRng(42)
  const out: string[] = []
  // Letters that are deliberately NOT 'x'.
  const pool = 'abcdefghijklmnopqrstuvwyz' // skip 'x'
  for (let i = 0; i < 200; i++) {
    const idx = Math.floor(rng() * pool.length)
    out.push(pool.charAt(idx))
  }
  // Place exactly one 'x' at a stable interior offset.
  out[137] = 'x'
  return out
}

const containsX = (s: string[]): boolean => s.includes('x')

describe('shrink — correctness', () => {
  it('reduces a 200-byte sequence containing one "x" to exactly ["x"]', () => {
    const input = build200WithSingleX()
    expect(containsX(input)).toBe(true) // sanity
    const shrunk = shrink(input, containsX)
    expect(shrunk).toEqual(['x'])
  })

  it('returns the original sequence when predicate never holds', () => {
    // No 'x' present → predicate is false from the start; shrinker should
    // not invent failures. By convention we return the input unchanged
    // (caller is expected to check predicate on the input first).
    const input = ['a', 'b', 'c']
    const shrunk = shrink(input, containsX)
    // Either return input as-is or the minimal known-bad subset. Since the
    // input doesn't reproduce, the only correct answer is the input itself.
    expect(shrunk).toEqual(input)
  })
})

describe('shrink — determinism', () => {
  it('same input + same predicate → identical output across calls', () => {
    const input = build200WithSingleX()
    const a = shrink(input, containsX)
    const b = shrink(input, containsX)
    const c = shrink(input, containsX)
    expect(a).toEqual(b)
    expect(b).toEqual(c)
  })

  it('respects maxIters bound without infinite loop', () => {
    const input = build200WithSingleX()
    // With a tiny budget the shrinker should still terminate and return
    // some sequence that still reproduces (predicate true on output).
    const shrunk = shrink(input, containsX, { maxIters: 5 })
    expect(containsX(shrunk)).toBe(true)
    expect(shrunk.length).toBeLessThanOrEqual(input.length)
  })
})
