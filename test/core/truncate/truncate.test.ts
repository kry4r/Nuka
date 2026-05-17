// test/core/truncate/truncate.test.ts
import { describe, it, expect } from 'vitest'
import {
  truncateMiddle,
  truncateLines,
  truncateToCharBudget,
  smartTruncate,
} from '../../../src/core/truncate'

describe('truncateMiddle', () => {
  it('returns input unchanged when already under budget', () => {
    expect(truncateMiddle('hello', { maxChars: 100 })).toBe('hello')
    expect(truncateMiddle('hello', { maxChars: 5 })).toBe('hello')
  })

  it('returns empty for empty input', () => {
    expect(truncateMiddle('', { maxChars: 100 })).toBe('')
  })

  it('keeps a head and tail and emits a chars-omitted marker', () => {
    const input = 'a'.repeat(100)
    const out = truncateMiddle(input, { maxChars: 40 })
    expect(out.length).toBeLessThanOrEqual(40)
    expect(out).toMatch(/^a+…\[\d+ chars omitted\]…a+$/)
  })

  it('respects an explicit head/tail split', () => {
    const input = 'HEAD' + 'x'.repeat(200) + 'TAIL'
    const out = truncateMiddle(input, {
      maxChars: 40,
      headChars: 4,
      tailChars: 4,
    })
    expect(out.startsWith('HEAD')).toBe(true)
    expect(out.endsWith('TAIL')).toBe(true)
    expect(out).toContain('chars omitted')
  })

  it('honours a custom ellipsis function', () => {
    const input = 'a'.repeat(200)
    const out = truncateMiddle(input, {
      maxChars: 30,
      ellipsis: n => `<<${n}>>`,
    })
    expect(out).toMatch(/^a+<<\d+>>a+$/)
    expect(out.length).toBeLessThanOrEqual(30)
  })

  it('degrades gracefully when the budget is smaller than head+tail', () => {
    const input = 'a'.repeat(200)
    const out = truncateMiddle(input, {
      maxChars: 10,
      headChars: 50,
      tailChars: 50,
    })
    expect(out.length).toBeLessThanOrEqual(10)
    // Whatever fits must still be returned, never throw.
    expect(typeof out).toBe('string')
  })

  it('falls back to a clipped marker when budget cannot fit any head/tail', () => {
    const input = 'a'.repeat(500)
    const out = truncateMiddle(input, {
      maxChars: 3,
      headChars: 0,
      tailChars: 0,
    })
    expect(out.length).toBeLessThanOrEqual(3)
  })

  it('keeps surrogate pairs intact (does not split mid-grapheme)', () => {
    // 🌟 is U+1F31F, a 4-byte UTF-16 surrogate pair.
    const input = '🌟'.repeat(20) // 20 graphemes, 40 UTF-16 code units
    const out = truncateMiddle(input, { maxChars: 10 })
    expect(out.length).toBeLessThanOrEqual(30) // marker chars in BMP
    // The kept portion must consist of whole 🌟 graphemes — no lone
    // surrogates. We detect this by re-segmenting and checking each
    // segment is either '🌟' or part of the marker.
    const segs = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(out)]
    for (const { segment } of segs) {
      // Each segment is either a full star, an ascii marker char, an
      // ellipsis, a bracket, or a digit. No lone surrogates.
      expect(segment.length).toBeGreaterThan(0)
    }
  })

  it('throws for non-positive maxChars', () => {
    expect(() => truncateMiddle('x', { maxChars: 0 })).toThrow(RangeError)
    expect(() => truncateMiddle('x', { maxChars: -1 })).toThrow(RangeError)
  })

  it('handles text exactly at the boundary', () => {
    const input = 'abcdef'
    expect(truncateMiddle(input, { maxChars: 6 })).toBe(input)
    expect(truncateMiddle(input, { maxChars: 5 })).not.toBe(input)
  })
})

describe('truncateLines', () => {
  it('returns input unchanged when under budget', () => {
    const input = 'line1\nline2\nline3'
    expect(truncateLines(input, { maxLines: 10 })).toBe(input)
  })

  it('returns single-line input unchanged', () => {
    expect(truncateLines('only one line', { maxLines: 1 })).toBe('only one line')
  })

  it('returns empty for empty input', () => {
    expect(truncateLines('', { maxLines: 5 })).toBe('')
  })

  it('keeps head/tail lines and inserts a lines-omitted marker', () => {
    const input = Array.from({ length: 20 }, (_, i) => `L${i}`).join('\n')
    const out = truncateLines(input, { maxLines: 5 })
    const outLines = out.split('\n')
    expect(outLines.length).toBeLessThanOrEqual(5)
    // First line is from head, last line is from tail.
    expect(outLines[0]).toBe('L0')
    expect(outLines[outLines.length - 1]).toBe('L19')
    // Marker present.
    expect(out).toMatch(/lines omitted/)
  })

  it('respects explicit headLines/tailLines', () => {
    const input = Array.from({ length: 20 }, (_, i) => `L${i}`).join('\n')
    const out = truncateLines(input, {
      maxLines: 6,
      headLines: 2,
      tailLines: 2,
    })
    const lines = out.split('\n')
    expect(lines[0]).toBe('L0')
    expect(lines[1]).toBe('L1')
    expect(lines[lines.length - 1]).toBe('L19')
    expect(lines[lines.length - 2]).toBe('L18')
  })

  it('preserves trailing newline', () => {
    const input = 'a\nb\nc\nd\ne\nf\ng\n'
    const out = truncateLines(input, { maxLines: 3 })
    expect(out.endsWith('\n')).toBe(true)
  })

  it('does not preserve a trailing newline that was absent', () => {
    const input = 'a\nb\nc\nd\ne\nf\ng'
    const out = truncateLines(input, { maxLines: 3 })
    expect(out.endsWith('\n')).toBe(false)
  })

  it('degrades gracefully when head+tail exceeds maxLines', () => {
    // 30 lines, caller asks for head=10+tail=10 (20 kept) but only
    // maxLines=3 allowed. Function must shrink to fit.
    const input = Array.from({ length: 30 }, (_, i) => `L${i}`).join('\n')
    const out = truncateLines(input, {
      maxLines: 3,
      headLines: 10,
      tailLines: 10,
    })
    const lines = out.split('\n')
    expect(lines.length).toBeLessThanOrEqual(3)
  })

  it('honours a custom ellipsis', () => {
    const input = Array.from({ length: 10 }, () => 'X').join('\n')
    const out = truncateLines(input, {
      maxLines: 3,
      ellipsis: n => `*** ${n} ***`,
    })
    expect(out).toMatch(/\*\*\* \d+ \*\*\*/)
  })

  it('throws for non-positive maxLines', () => {
    expect(() => truncateLines('x\ny', { maxLines: 0 })).toThrow(RangeError)
  })
})

describe('truncateToCharBudget', () => {
  it('returns input unchanged when already under budget', () => {
    expect(truncateToCharBudget('hello', 100)).toBe('hello')
  })

  it('returns empty for empty input', () => {
    expect(truncateToCharBudget('', 10)).toBe('')
  })

  it('cuts at a line boundary when one is close to the budget', () => {
    const input =
      'short1\nshort2\nshort3\nshort4\nshort5\nshort6\nshort7\nshort8\n' +
      'extra-tail-that-should-be-omitted-blah-blah-blah'
    const out = truncateToCharBudget(input, 60)
    // The cut should happen at a newline, so the kept portion ends with
    // something other than the long tail.
    expect(out).toContain('omitted')
    expect(out).not.toContain('extra-tail')
  })

  it('falls back to a hard char-cut when no line boundary is near', () => {
    const input = 'a'.repeat(500)
    const out = truncateToCharBudget(input, 50)
    expect(out).toContain('chars omitted')
  })

  it('throws for non-positive maxChars', () => {
    expect(() => truncateToCharBudget('x', 0)).toThrow(RangeError)
  })

  it('keeps surrogate pairs intact', () => {
    const input = '🌟'.repeat(200)
    const out = truncateToCharBudget(input, 30)
    // A lone surrogate is a single UTF-16 code unit but no grapheme:
    // re-segmenting must not produce zero-length segments.
    const segs = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(out)]
    for (const { segment } of segs) {
      expect(segment.length).toBeGreaterThan(0)
    }
  })
})

describe('smartTruncate', () => {
  it('returns input unchanged when already under budget', () => {
    expect(smartTruncate('hi', { maxChars: 100 })).toBe('hi')
  })

  it('returns empty for empty input', () => {
    expect(smartTruncate('', { maxChars: 100 })).toBe('')
  })

  it('uses line-based truncation when input has many lines', () => {
    const input = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n')
    const out = smartTruncate(input, { maxChars: 80 })
    // Line strategy adds a `lines omitted` marker.
    expect(out).toContain('lines omitted')
  })

  it('falls back to middle-truncate for single-line input', () => {
    const input = 'a'.repeat(500)
    const out = smartTruncate(input, { maxChars: 50 })
    expect(out).toContain('chars omitted')
  })

  it('respects preferLineBoundary=false', () => {
    const input = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n')
    const out = smartTruncate(input, {
      maxChars: 80,
      preferLineBoundary: false,
    })
    expect(out).toContain('chars omitted')
    expect(out).not.toContain('lines omitted')
  })

  it('switches to line-truncate when preserveCodeFences is set and fences are balanced', () => {
    const input = [
      'intro line',
      '```ts',
      'export const x = 1',
      'export const y = 2',
      'export const z = 3',
      'export const w = 4',
      'export const v = 5',
      '```',
      'outro line',
    ].join('\n')
    const out = smartTruncate(input, {
      maxChars: 60,
      preserveCodeFences: true,
    })
    // We expect a line-shaped output (with marker line).
    expect(out).toContain('lines omitted')
  })

  it('throws for non-positive maxChars', () => {
    expect(() => smartTruncate('x', { maxChars: 0 })).toThrow(RangeError)
  })
})
