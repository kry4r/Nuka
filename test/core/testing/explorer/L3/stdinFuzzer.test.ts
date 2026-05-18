// test/core/testing/explorer/L3/stdinFuzzer.test.ts
//
// M3.T1 — RED-first tests for the deterministic stdin fuzzer.
// See locked spec §4.4: charset bound, seed determinism, viewport resize.
//
// 3 tests:
//   1. determinism: same seed → identical 200-key sequence.
//   2. charset exclusion: raw Ctrl-C (0x03), Ctrl-D (0x04), Ctrl-Z (0x1A)
//      MUST NEVER appear in any drawn key over a 5000-draw budget.
//   3. resize-probability bound: shouldResize(p) returns true with probability
//      ≈ p over 10k draws (within ±0.02 absolute).

import { describe, it, expect } from 'vitest'
import { StdinFuzzer } from '../../../../../src/core/testing/explorer/L3/stdinFuzzer'

describe('StdinFuzzer — determinism', () => {
  it('same seed produces identical 200-key sequence', () => {
    const a = new StdinFuzzer(42)
    const b = new StdinFuzzer(42)
    const aKeys: string[] = []
    const bKeys: string[] = []
    for (let i = 0; i < 200; i++) {
      aKeys.push(a.nextKey())
      bKeys.push(b.nextKey())
    }
    expect(aKeys).toEqual(bKeys)
    // A different seed should diverge (cheap sanity).
    const c = new StdinFuzzer(43)
    const cKeys: string[] = []
    for (let i = 0; i < 200; i++) cKeys.push(c.nextKey())
    expect(cKeys).not.toEqual(aKeys)
  })
})

describe('StdinFuzzer — charset exclusion', () => {
  it('never emits raw Ctrl-C (0x03), Ctrl-D (0x04), or Ctrl-Z (0x1A)', () => {
    const fuzzer = new StdinFuzzer(7)
    const banned = new Set(['\u0003', '\u0004', '\u001A'])
    for (let i = 0; i < 5000; i++) {
      const k = fuzzer.nextKey()
      // A keystroke is a string of one or more bytes (e.g. arrow keys are
      // multi-byte escape sequences). None of its bytes may be banned.
      for (const ch of k) {
        expect(banned.has(ch)).toBe(false)
      }
    }
  })
})

describe('StdinFuzzer — resize probability', () => {
  it('shouldResize(p) returns true with probability ≈ p ± 0.02 over 10k draws', () => {
    const fuzzer = new StdinFuzzer(123)
    const p = 0.1
    const N = 10_000
    let trues = 0
    for (let i = 0; i < N; i++) {
      if (fuzzer.shouldResize(p)) trues++
    }
    const empirical = trues / N
    expect(Math.abs(empirical - p)).toBeLessThan(0.02)
  })

  it('pickViewport returns deterministic choice from matrix', () => {
    const matrix = [
      { cols: 60, rows: 20 },
      { cols: 80, rows: 24 },
      { cols: 100, rows: 30 },
    ]
    const a = new StdinFuzzer(99)
    const b = new StdinFuzzer(99)
    const aPicks = [a.pickViewport(matrix), a.pickViewport(matrix), a.pickViewport(matrix)]
    const bPicks = [b.pickViewport(matrix), b.pickViewport(matrix), b.pickViewport(matrix)]
    expect(aPicks).toEqual(bPicks)
    for (const v of aPicks) expect(matrix).toContainEqual(v)
  })
})
