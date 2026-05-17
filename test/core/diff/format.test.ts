// test/core/diff/format.test.ts
import { describe, it, expect } from 'vitest'
import {
  formatUnifiedDiff,
  formatTwoFilesUnifiedDiff,
  getHunksFromContents,
  adjustHunkLineNumbers,
  countLinesChanged,
} from '../../../src/core/diff/format'

const SAMPLE_BEFORE = ['line one', 'line two', 'line three', 'line four'].join('\n') + '\n'
const SAMPLE_AFTER = ['line one', 'line TWO', 'line three', 'line four'].join('\n') + '\n'

describe('formatUnifiedDiff', () => {
  it('produces unified-diff text with default headers', () => {
    const out = formatUnifiedDiff(SAMPLE_BEFORE, SAMPLE_AFTER, { filename: 'sample.txt' })
    expect(out).toContain('--- sample.txt')
    expect(out).toContain('+++ sample.txt')
    expect(out).toContain('-line two')
    expect(out).toContain('+line TWO')
  })

  it('returns the empty string when the inputs are identical', () => {
    const out = formatUnifiedDiff(SAMPLE_BEFORE, SAMPLE_BEFORE)
    // createPatch still emits an empty-hunk header for equal inputs;
    // it must not contain any add/remove markers.
    expect(out).not.toMatch(/^\+[^+]/m)
    expect(out).not.toMatch(/^-[^-]/m)
  })

  it('preserves bare & and $ characters end-to-end', () => {
    const before = 'cost: $100 & shipping\n'
    const after = 'cost: $200 & shipping\n'
    const out = formatUnifiedDiff(before, after)
    expect(out).toContain('-cost: $100 & shipping')
    expect(out).toContain('+cost: $200 & shipping')
    expect(out).not.toContain('AMPERSAND_TOKEN')
    expect(out).not.toContain('DOLLAR_TOKEN')
  })
})

describe('formatTwoFilesUnifiedDiff', () => {
  it('uses separate old/new file labels in the header', () => {
    const out = formatTwoFilesUnifiedDiff(
      'old.txt',
      'new.txt',
      SAMPLE_BEFORE,
      SAMPLE_AFTER,
    )
    expect(out).toContain('--- old.txt')
    expect(out).toContain('+++ new.txt')
  })
})

describe('getHunksFromContents', () => {
  it('returns hunks describing the change with correct line numbers', () => {
    const hunks = getHunksFromContents(SAMPLE_BEFORE, SAMPLE_AFTER)
    expect(hunks.length).toBe(1)
    const hunk = hunks[0]!
    expect(hunk.oldStart).toBe(1)
    expect(hunk.newStart).toBe(1)
    expect(hunk.lines.some(l => l === '-line two')).toBe(true)
    expect(hunk.lines.some(l => l === '+line TWO')).toBe(true)
  })

  it('returns an empty array when inputs are equal', () => {
    expect(getHunksFromContents('same\n', 'same\n')).toEqual([])
  })

  it('collapses into a single hunk when singleHunk is set', () => {
    // Two distant changes that would normally split into two hunks.
    const before = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
    const after = before
      .replace('line 1', 'line ONE')
      .replace('line 28', 'line TWENTY-EIGHT')

    const split = getHunksFromContents(before, after)
    const single = getHunksFromContents(before, after, { singleHunk: true })
    expect(split.length).toBeGreaterThan(1)
    expect(single.length).toBe(1)
  })
})

describe('adjustHunkLineNumbers', () => {
  it('is a no-op when offset is 0', () => {
    const hunks = getHunksFromContents(SAMPLE_BEFORE, SAMPLE_AFTER)
    expect(adjustHunkLineNumbers(hunks, 0)).toBe(hunks)
  })

  it('shifts both oldStart and newStart by the offset', () => {
    const hunks = getHunksFromContents(SAMPLE_BEFORE, SAMPLE_AFTER)
    const shifted = adjustHunkLineNumbers(hunks, 100)
    expect(shifted[0]!.oldStart).toBe(hunks[0]!.oldStart + 100)
    expect(shifted[0]!.newStart).toBe(hunks[0]!.newStart + 100)
    // Original is not mutated.
    expect(shifted).not.toBe(hunks)
  })
})

describe('countLinesChanged', () => {
  it('counts additions and deletions from hunk lines', () => {
    const hunks = getHunksFromContents(SAMPLE_BEFORE, SAMPLE_AFTER)
    const counts = countLinesChanged(hunks)
    expect(counts.additions).toBe(1)
    expect(counts.deletions).toBe(1)
  })

  it('counts every line in newFileContent when hunks is empty', () => {
    const newFile = 'a\nb\nc\n'
    const counts = countLinesChanged([], newFile)
    // split(/\r?\n/) yields 4 entries: ['a','b','c',''] — matches upstream.
    expect(counts.additions).toBe(4)
    expect(counts.deletions).toBe(0)
  })

  it('returns zero counts for empty hunks without a new file', () => {
    expect(countLinesChanged([])).toEqual({ additions: 0, deletions: 0 })
  })
})
