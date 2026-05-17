// test/core/diff/lines.test.ts
import { describe, it, expect } from 'vitest'
import {
  diffLinesSimple,
  summariseLineChanges,
} from '../../../src/core/diff/lines'

const BEFORE = ['alpha', 'beta', 'gamma'].join('\n') + '\n'
const AFTER = ['alpha', 'BETA', 'gamma', 'delta'].join('\n') + '\n'

describe('diffLinesSimple', () => {
  it('produces add / del / eq segments that reconstruct each side', () => {
    const segs = diffLinesSimple(BEFORE, AFTER)
    // Every segment has a valid op.
    for (const s of segs) {
      expect(['add', 'del', 'eq']).toContain(s.op)
    }
    // Reconstructing the "before" side from non-add segments matches.
    const reconstructedBefore = segs
      .filter(s => s.op !== 'add')
      .map(s => s.value)
      .join('')
    expect(reconstructedBefore).toBe(BEFORE)
    // Reconstructing the "after" side from non-del segments matches.
    const reconstructedAfter = segs
      .filter(s => s.op !== 'del')
      .map(s => s.value)
      .join('')
    expect(reconstructedAfter).toBe(AFTER)
  })

  it('returns a single eq segment for identical inputs', () => {
    const segs = diffLinesSimple(BEFORE, BEFORE)
    expect(segs.length).toBe(1)
    expect(segs[0]!.op).toBe('eq')
    expect(segs[0]!.value).toBe(BEFORE)
  })

  it('emits one segment per line when oneSegmentPerLine is true', () => {
    const segs = diffLinesSimple(BEFORE, BEFORE, { oneSegmentPerLine: true })
    expect(segs.length).toBeGreaterThan(1)
    for (const s of segs) {
      expect(s.count).toBe(1)
    }
  })

  it('treats whitespace-only differences as eq when ignoreWhitespace is true', () => {
    const a = 'line one\nline two\n'
    const b = 'line one   \nline two\n'
    const strict = diffLinesSimple(a, b)
    const loose = diffLinesSimple(a, b, { ignoreWhitespace: true })
    expect(strict.some(s => s.op !== 'eq')).toBe(true)
    expect(loose.every(s => s.op === 'eq')).toBe(true)
  })
})

describe('summariseLineChanges', () => {
  it('totals added / removed / unchanged line counts', () => {
    const summary = summariseLineChanges(BEFORE, AFTER)
    expect(summary.added).toBe(2)
    expect(summary.removed).toBe(1)
    expect(summary.unchanged).toBe(2)
  })

  it('returns zero added/removed for identical inputs', () => {
    const summary = summariseLineChanges(BEFORE, BEFORE)
    expect(summary.added).toBe(0)
    expect(summary.removed).toBe(0)
    expect(summary.unchanged).toBeGreaterThan(0)
  })
})
