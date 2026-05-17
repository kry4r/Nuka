// test/core/diff/index.test.ts
//
// Smoke test for the barrel — ensures every advertised export resolves
// and shares the same identity as its source.

import { describe, it, expect } from 'vitest'
import * as Diff from '../../../src/core/diff'
import * as Format from '../../../src/core/diff/format'
import * as Parse from '../../../src/core/diff/parse'
import * as Apply from '../../../src/core/diff/apply'
import * as Lines from '../../../src/core/diff/lines'

describe('src/core/diff barrel', () => {
  it('re-exports all format helpers', () => {
    expect(Diff.formatUnifiedDiff).toBe(Format.formatUnifiedDiff)
    expect(Diff.formatTwoFilesUnifiedDiff).toBe(Format.formatTwoFilesUnifiedDiff)
    expect(Diff.getHunksFromContents).toBe(Format.getHunksFromContents)
    expect(Diff.adjustHunkLineNumbers).toBe(Format.adjustHunkLineNumbers)
    expect(Diff.countLinesChanged).toBe(Format.countLinesChanged)
    expect(Diff.DEFAULT_CONTEXT_LINES).toBe(Format.DEFAULT_CONTEXT_LINES)
    expect(Diff.DEFAULT_DIFF_TIMEOUT_MS).toBe(Format.DEFAULT_DIFF_TIMEOUT_MS)
  })

  it('re-exports parse helpers', () => {
    expect(Diff.parseUnifiedDiff).toBe(Parse.parseUnifiedDiff)
    expect(Diff.parseUnifiedDiffSingleFile).toBe(Parse.parseUnifiedDiffSingleFile)
  })

  it('re-exports apply helpers', () => {
    expect(Diff.applyUnifiedDiff).toBe(Apply.applyUnifiedDiff)
  })

  it('re-exports line helpers', () => {
    expect(Diff.diffLinesSimple).toBe(Lines.diffLinesSimple)
    expect(Diff.summariseLineChanges).toBe(Lines.summariseLineChanges)
  })

  it('format → parse → apply round-trips back to the new content', () => {
    const before = 'one\ntwo\nthree\n'
    const after = 'one\nTWO\nthree\nfour\n'
    const diffText = Diff.formatUnifiedDiff(before, after, { filename: 'r.txt' })
    const parsed = Diff.parseUnifiedDiff(diffText)
    expect(parsed.files.length).toBe(1)
    const applied = Diff.applyUnifiedDiff(before, diffText)
    expect(applied.success).toBe(true)
    if (applied.success) {
      expect(applied.result).toBe(after)
    }
  })
})
