// test/core/diff/parse.test.ts
import { describe, it, expect } from 'vitest'
import { formatUnifiedDiff } from '../../../src/core/diff/format'
import {
  parseUnifiedDiff,
  parseUnifiedDiffSingleFile,
} from '../../../src/core/diff/parse'

const BEFORE = 'alpha\nbeta\ngamma\ndelta\n'
const AFTER = 'alpha\nBETA\ngamma\ndelta\n'

describe('parseUnifiedDiff', () => {
  it('round-trips a single-file patch into a parsed file with hunks', () => {
    const diffText = formatUnifiedDiff(BEFORE, AFTER, { filename: 'sample.txt' })
    const parsed = parseUnifiedDiff(diffText)
    expect(parsed.files.length).toBe(1)
    const file = parsed.files[0]!
    expect(file.oldFileName).toBe('sample.txt')
    expect(file.newFileName).toBe('sample.txt')
    expect(file.hunks.length).toBe(1)
    expect(file.hunks[0]!.lines.some(l => l.startsWith('+BETA'))).toBe(true)
    expect(file.hunks[0]!.lines.some(l => l.startsWith('-beta'))).toBe(true)
  })

  it('returns an empty files array for empty input', () => {
    expect(parseUnifiedDiff('')).toEqual({ files: [] })
    expect(parseUnifiedDiff('   \n  ')).toEqual({ files: [] })
  })

  it('parses a hand-written unified diff', () => {
    const handcrafted = [
      '--- a.txt',
      '+++ b.txt',
      '@@ -1,3 +1,3 @@',
      ' first',
      '-second',
      '+SECOND',
      ' third',
      '',
    ].join('\n')
    const parsed = parseUnifiedDiff(handcrafted)
    expect(parsed.files.length).toBe(1)
    expect(parsed.files[0]!.oldFileName).toBe('a.txt')
    expect(parsed.files[0]!.newFileName).toBe('b.txt')
    expect(parsed.files[0]!.hunks[0]!.oldStart).toBe(1)
    expect(parsed.files[0]!.hunks[0]!.newStart).toBe(1)
  })
})

describe('parseUnifiedDiffSingleFile', () => {
  it('returns the first file from a single-file diff', () => {
    const diffText = formatUnifiedDiff(BEFORE, AFTER)
    const file = parseUnifiedDiffSingleFile(diffText)
    expect(file).not.toBeNull()
    expect(file!.hunks.length).toBe(1)
  })

  it('returns null for an empty diff', () => {
    expect(parseUnifiedDiffSingleFile('')).toBeNull()
  })
})
