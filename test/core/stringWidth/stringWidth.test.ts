// test/core/stringWidth/stringWidth.test.ts
import { describe, it, expect } from 'vitest'
import {
  stripAnsi,
  charWidth,
  stringWidth,
  truncateByWidth,
  padToWidth,
} from '../../../src/core/stringWidth'

// Build ANSI sequences as runtime strings rather than literal escape
// codes to keep this file editable in a wider range of editors.
const ESC = ''
const RED = `${ESC}[31m`
const RESET = `${ESC}[0m`
const BOLD = `${ESC}[1m`

describe('stripAnsi', () => {
  it('removes SGR sequences', () => {
    expect(stripAnsi(`${RED}error${RESET}`)).toBe('error')
  })

  it('returns empty string for empty / non-string input', () => {
    expect(stripAnsi('')).toBe('')
    expect(stripAnsi(undefined as unknown as string)).toBe('')
    expect(stripAnsi(null as unknown as string)).toBe('')
  })

  it('leaves clean text alone', () => {
    expect(stripAnsi('plain')).toBe('plain')
  })
})

describe('charWidth', () => {
  it('ASCII printable = 1', () => {
    expect(charWidth('a'.codePointAt(0)!)).toBe(1)
    expect(charWidth('A'.codePointAt(0)!)).toBe(1)
    expect(charWidth(' '.codePointAt(0)!)).toBe(1)
    expect(charWidth('~'.codePointAt(0)!)).toBe(1)
  })

  it('control char = 0', () => {
    expect(charWidth(0x07)).toBe(0) // BEL
    expect(charWidth(0x1b)).toBe(0) // ESC
    expect(charWidth(0x00)).toBe(0) // NUL
  })

  it('CJK fullwidth = 2', () => {
    expect(charWidth('古'.codePointAt(0)!)).toBe(2)
    expect(charWidth('日'.codePointAt(0)!)).toBe(2)
    expect(charWidth('한'.codePointAt(0)!)).toBe(2)
  })

  it('combining mark = 0', () => {
    expect(charWidth(0x0301)).toBe(0) // combining acute
    expect(charWidth(0x0300)).toBe(0) // combining grave
  })

  it('emoji code point = 2', () => {
    expect(charWidth(0x1f600)).toBe(2) // 😀
    expect(charWidth(0x1f31f)).toBe(2) // 🌟
  })

  it('zero-width joiner = 0', () => {
    expect(charWidth(0x200d)).toBe(0)
  })

  it('rejects invalid input', () => {
    expect(charWidth(-1)).toBe(0)
    expect(charWidth(1.5)).toBe(0)
    expect(charWidth(Number.NaN)).toBe(0)
  })
})

describe('stringWidth', () => {
  it('ASCII width equals length', () => {
    expect(stringWidth('hello')).toBe(5)
    expect(stringWidth('abc def')).toBe(7)
  })

  it('empty string is 0', () => {
    expect(stringWidth('')).toBe(0)
  })

  it('ANSI-only string is 0', () => {
    expect(stringWidth(`${RED}${RESET}`)).toBe(0)
    expect(stringWidth(`${BOLD}${RESET}`)).toBe(0)
  })

  it('strips ANSI by default', () => {
    expect(stringWidth(`${RED}error${RESET}`)).toBe(5)
    expect(stringWidth(`${BOLD}hi${RESET}`)).toBe(2)
  })

  it('counts ANSI when countAnsi: true', () => {
    // Whatever the exact count is, it must be larger than the
    // stripped width — that's the contract.
    const stripped = stringWidth(`${RED}x${RESET}`)
    const raw = stringWidth(`${RED}x${RESET}`, { countAnsi: true })
    expect(raw).toBeGreaterThan(stripped)
  })

  it('CJK characters are width 2 each', () => {
    expect(stringWidth('古')).toBe(2)
    expect(stringWidth('日本語')).toBe(6)
    expect(stringWidth('한국어')).toBe(6)
  })

  it('emoji is width 2', () => {
    expect(stringWidth('😀')).toBe(2)
    expect(stringWidth('🌟')).toBe(2)
  })

  it('ZWJ family emoji renders as one width-2 cluster', () => {
    // 👨‍👩‍👧 = man + ZWJ + woman + ZWJ + girl. One grapheme, width 2.
    const family = '\u{1F468}‍\u{1F469}‍\u{1F467}'
    expect(stringWidth(family)).toBe(2)
  })

  it('combining marks are width 0', () => {
    // `é` decomposed = e + combining acute. Width should be 1.
    const decomposed = 'é'
    expect(stringWidth(decomposed)).toBe(1)
    // Whole word with combining marks.
    expect(stringWidth('café')).toBe(4)
  })

  it('precomposed CJK is still width 2', () => {
    expect(stringWidth('café')).toBe(4) // precomposed é
  })

  it('tab defaults to width 8', () => {
    expect(stringWidth('a\tb')).toBe(1 + 8 + 1)
    expect(stringWidth('\t')).toBe(8)
    expect(stringWidth('\t\t')).toBe(16)
  })

  it('tab width is configurable', () => {
    expect(stringWidth('a\tb', { tabWidth: 4 })).toBe(1 + 4 + 1)
    expect(stringWidth('a\tb', { tabWidth: 0 })).toBe(2)
    expect(stringWidth('a\tb', { tabWidth: 2 })).toBe(4)
  })

  it('rejects negative or non-integer tabWidth', () => {
    expect(() => stringWidth('a', { tabWidth: -1 })).toThrow(RangeError)
    expect(() => stringWidth('a', { tabWidth: 1.5 })).toThrow(RangeError)
  })

  it('mixed ASCII + CJK + ANSI', () => {
    expect(stringWidth(`hi ${RED}古${RESET} world`)).toBe(
      2 + 1 + 2 + 1 + 5,
    )
  })

  it('non-string input returns 0', () => {
    expect(stringWidth(undefined as unknown as string)).toBe(0)
    expect(stringWidth(null as unknown as string)).toBe(0)
  })
})

describe('truncateByWidth', () => {
  it('returns input unchanged when already under budget', () => {
    expect(truncateByWidth('hello', 100)).toBe('hello')
    expect(truncateByWidth('hello', 5)).toBe('hello')
  })

  it('returns empty for empty input or zero budget', () => {
    expect(truncateByWidth('', 10)).toBe('')
    expect(truncateByWidth('hello', 0)).toBe('')
  })

  it('truncates ASCII to fit budget with default ellipsis', () => {
    const out = truncateByWidth('abcdefghij', 5)
    expect(stringWidth(out)).toBeLessThanOrEqual(5)
    expect(out.endsWith('…')).toBe(true)
  })

  it('uses custom ellipsis string', () => {
    const out = truncateByWidth('abcdefghij', 7, { ellipsis: '...' })
    expect(stringWidth(out)).toBeLessThanOrEqual(7)
    expect(out.endsWith('...')).toBe(true)
  })

  it('respects ellipsis="" (hard cut, no marker)', () => {
    const out = truncateByWidth('abcdefghij', 4, { ellipsis: '' })
    expect(out).toBe('abcd')
  })

  it('strips ANSI before truncating', () => {
    const out = truncateByWidth(`${RED}hello world${RESET}`, 5)
    expect(stringWidth(out)).toBeLessThanOrEqual(5)
    // We dropped colours per the docstring contract.
    expect(out).not.toContain(ESC)
  })

  it('CJK truncation counts in cells', () => {
    // 4 CJK chars = 8 cells; budget 5 → 2 chars fit + ellipsis.
    const out = truncateByWidth('日本語学', 5)
    expect(stringWidth(out)).toBeLessThanOrEqual(5)
    // Cannot fit 3 CJK chars (=6) + ellipsis(=1), so we get 2 + ellipsis.
    expect(out).toBe('日本…')
  })

  it('never splits a surrogate pair', () => {
    // 5 stars = 10 cells. Budget 5 cells → 2 stars + ellipsis.
    const out = truncateByWidth('🌟🌟🌟🌟🌟', 5)
    expect(stringWidth(out)).toBeLessThanOrEqual(5)
    // No lone surrogates: each codepoint walks back to a known emoji
    // or the ellipsis.
    for (const ch of out) {
      const cp = ch.codePointAt(0)!
      expect(cp === 0x1f31f || ch === '…').toBe(true)
    }
  })

  it('never splits a ZWJ emoji cluster', () => {
    const family = '\u{1F468}‍\u{1F469}‍\u{1F467}' // width 2
    // 3 families = ~6 cells; budget 3 → 1 family + ellipsis (3 cells).
    const out = truncateByWidth(family + family + family, 3)
    expect(stringWidth(out)).toBeLessThanOrEqual(3)
    // Either contains a full family or just the ellipsis, never a
    // partial cluster.
    if (out !== '…') {
      expect(out.startsWith(family) || out === '…').toBe(true)
    }
  })

  it('drops marker when budget cannot fit even the marker', () => {
    // Budget 1, ellipsis width 1 — same width as marker. The
    // implementation hard-cuts in this corner case.
    const out = truncateByWidth('abcdef', 1, { ellipsis: '…' })
    expect(stringWidth(out)).toBeLessThanOrEqual(1)
  })

  it('rejects negative budget', () => {
    expect(() => truncateByWidth('a', -1)).toThrow(RangeError)
  })

  it('honours tab width in measurements', () => {
    // 'a\tb' with tabWidth=4 = 1+4+1 = 6 cells.
    const out = truncateByWidth('a\tb', 5, { tabWidth: 4 })
    expect(stringWidth(out, { tabWidth: 4 })).toBeLessThanOrEqual(5)
  })

  it('non-string input returns empty', () => {
    expect(truncateByWidth(undefined as unknown as string, 10)).toBe('')
  })
})

describe('padToWidth', () => {
  it('left-pads (default = align left, fill space)', () => {
    expect(padToWidth('hi', 5)).toBe('hi   ')
    expect(stringWidth(padToWidth('hi', 5))).toBe(5)
  })

  it('right-pads', () => {
    expect(padToWidth('hi', 5, { align: 'right' })).toBe('   hi')
  })

  it('center-pads with extra on the right on odd remainder', () => {
    expect(padToWidth('hi', 5, { align: 'center' })).toBe(' hi  ')
    expect(padToWidth('hi', 6, { align: 'center' })).toBe('  hi  ')
  })

  it('does nothing when already at/over target', () => {
    expect(padToWidth('hello', 5)).toBe('hello')
    expect(padToWidth('hello', 3)).toBe('hello') // no truncation
  })

  it('supports custom fill char', () => {
    expect(padToWidth('x', 5, { fillChar: '-' })).toBe('x----')
    expect(padToWidth('x', 5, { fillChar: '.', align: 'right' })).toBe('....x')
  })

  it('counts CJK input as width 2 each when budgeting', () => {
    // '古' = 2 cells; pad to 5 → 3 spaces.
    expect(padToWidth('古', 5)).toBe('古   ')
    expect(stringWidth(padToWidth('古', 5))).toBe(5)
  })

  it('rejects multi-cell fill char', () => {
    expect(() => padToWidth('x', 5, { fillChar: '古' })).toThrow(RangeError)
  })

  it('rejects empty fill char', () => {
    expect(() => padToWidth('x', 5, { fillChar: '' })).toThrow(RangeError)
  })

  it('rejects negative target', () => {
    expect(() => padToWidth('x', -1)).toThrow(RangeError)
  })

  it('handles empty input', () => {
    expect(padToWidth('', 3)).toBe('   ')
    expect(padToWidth('', 0)).toBe('')
  })

  it('non-string input is coerced to empty', () => {
    expect(padToWidth(undefined as unknown as string, 3)).toBe('   ')
  })
})

describe('edge cases — surrogate-pair integrity end-to-end', () => {
  it('truncateByWidth followed by stringWidth round-trips for emoji', () => {
    const stars = '🌟'.repeat(50) // 100 cells
    for (const budget of [0, 1, 2, 3, 4, 5, 10, 50, 100, 101]) {
      const out = truncateByWidth(stars, budget)
      expect(stringWidth(out)).toBeLessThanOrEqual(budget)
    }
  })

  it('padToWidth + truncateByWidth fixed-width formatter', () => {
    // The canonical use case: format a value into a fixed-width
    // column. Combining the two helpers should yield a string with
    // exactly the requested width, whether the input was shorter
    // (padded) or longer (truncated).
    const examples = ['hi', '古', '🌟', 'longer text here', '']
    for (const value of examples) {
      const w = 10
      const formatted = padToWidth(truncateByWidth(value, w), w)
      expect(stringWidth(formatted)).toBe(w)
    }
  })
})
