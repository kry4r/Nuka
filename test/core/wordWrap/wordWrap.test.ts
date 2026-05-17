// test/core/wordWrap/wordWrap.test.ts
import { describe, it, expect } from 'vitest'
import {
  wrapText,
  wrapLines,
  wrapWithPrefix,
} from '../../../src/core/wordWrap'

// Build ANSI sequences as runtime strings rather than literal escape
// codes to keep this file editable in a wider range of editors.
const ESC = ''
const RED = `${ESC}[31m`
const RESET = `${ESC}[0m`
const BOLD = `${ESC}[1m`

describe('wrapText — empty / trivial input', () => {
  it('returns empty for empty string', () => {
    expect(wrapText('', { width: 10 })).toBe('')
  })

  it('returns empty for non-string input', () => {
    expect(wrapText(undefined as unknown as string, { width: 10 })).toBe('')
    expect(wrapText(null as unknown as string, { width: 10 })).toBe('')
  })

  it('single short word fits in one line', () => {
    expect(wrapText('hello', { width: 10 })).toBe('hello')
  })

  it('single word equal to width fits exactly', () => {
    expect(wrapText('hello', { width: 5 })).toBe('hello')
  })
})

describe('wrapText — word-boundary wrapping', () => {
  it('wraps a long line at spaces', () => {
    const out = wrapText('the quick brown fox jumps over', { width: 10 })
    // "the quick" = 9, "brown fox" = 9, "jumps over" = 10
    expect(out.split('\n')).toEqual(['the quick', 'brown fox', 'jumps over'])
  })

  it('collapses internal multi-space runs to single space', () => {
    const out = wrapText('a    b    c', { width: 10 })
    expect(out).toBe('a b c')
  })

  it('strips leading and trailing whitespace from paragraph', () => {
    const out = wrapText('   hello world   ', { width: 20 })
    expect(out).toBe('hello world')
  })

  it('emits one word per line when width is exactly 1 cell less than two words', () => {
    // "aa bb" = 5, width 4 → two lines
    expect(wrapText('aa bb', { width: 4 }).split('\n')).toEqual(['aa', 'bb'])
  })
})

describe('wrapText — overlong words', () => {
  it('keeps a word longer than width on its own (overflowing) line by default', () => {
    const out = wrapText('hi superlongwordhere bye', { width: 5 })
    const lines = out.split('\n')
    expect(lines).toEqual(['hi', 'superlongwordhere', 'bye'])
    // overlong line is allowed to overflow with breakWord:false (default)
    expect(lines[1]!.length).toBeGreaterThan(5)
  })

  it('hard-breaks an overlong word when breakWord: true', () => {
    const out = wrapText('superlongwordhere', { width: 5, breakWord: true })
    const lines = out.split('\n')
    // 17 chars / 5 budget → 4 segments: 5, 5, 5, 2
    expect(lines).toEqual(['super', 'longw', 'ordhe', 're'])
  })

  it('hard-breaks an overlong word mid-paragraph', () => {
    const out = wrapText('hi superlongwordhere bye', {
      width: 5,
      breakWord: true,
    })
    const lines = out.split('\n')
    // 'hi' fits alone, then 17-char word broken into 5/5/5/2, then 'bye'
    expect(lines).toEqual(['hi', 'super', 'longw', 'ordhe', 're', 'bye'])
  })
})

describe('wrapText — paragraphs', () => {
  it('preserves newlines as paragraph breaks by default', () => {
    const out = wrapText('first paragraph here\nsecond paragraph', { width: 12 })
    expect(out).toBe('first\nparagraph\nhere\nsecond\nparagraph')
  })

  it('preserves blank lines between paragraphs', () => {
    const out = wrapText('one\n\ntwo', { width: 10 })
    expect(out.split('\n')).toEqual(['one', '', 'two'])
  })

  it('flattens newlines into one paragraph when preserveNewlines: false', () => {
    const out = wrapText('alpha\nbeta\ngamma', {
      width: 20,
      preserveNewlines: false,
    })
    expect(out).toBe('alpha beta gamma')
  })

  it('multi-paragraph each wraps independently', () => {
    const out = wrapText('aaaa bbbb cccc\ndddd eeee ffff', { width: 9 })
    const lines = out.split('\n')
    expect(lines).toEqual(['aaaa bbbb', 'cccc', 'dddd eeee', 'ffff'])
  })
})

describe('wrapText — indent and hangingIndent', () => {
  it('applies indent to every line', () => {
    const out = wrapText('the quick brown fox', { width: 12, indent: 2 })
    // budget = 12 - 2 = 10, so "the quick" (9) + " " + "brown" (5) → 15 doesn't fit
    // line1: "  the quick" (10 visible)
    // line2: "  brown fox" (10 visible)
    expect(out.split('\n')).toEqual(['  the quick', '  brown fox'])
  })

  it('applies hangingIndent only to continuation lines', () => {
    const out = wrapText('the quick brown fox jumps', {
      width: 12,
      hangingIndent: 2,
    })
    const lines = out.split('\n')
    // Line 1: full width 12; "the quick" fits (9), "the quick brown" would be 15 → no
    // Line 2+: budget 10 due to hanging indent
    expect(lines[0]).toBe('the quick')
    expect(lines[1]).toMatch(/^ {2}\S/)
  })

  it('combines indent and hangingIndent on continuation lines', () => {
    const out = wrapText('the quick brown fox', {
      width: 14,
      indent: 1,
      hangingIndent: 2,
    })
    const lines = out.split('\n')
    // Line 1: 1 space + content (budget 13)
    // Line 2+: 3 spaces + content (budget 11)
    expect(lines[0]!.startsWith(' ')).toBe(true)
    expect(lines[0]!.startsWith('  ')).toBe(false)
    if (lines.length > 1) {
      expect(lines[1]!.startsWith('   ')).toBe(true)
    }
  })

  it('caps indent so each line has at least 1 writable cell', () => {
    // indent=10, width=5 → indent capped to 4 (width-1)
    const out = wrapText('a b c d', { width: 5, indent: 10 })
    // Each line gets at most 1 char of content after 4 spaces.
    for (const line of out.split('\n')) {
      expect(line.startsWith('    ')).toBe(true)
    }
  })

  it('throws on negative indent', () => {
    expect(() => wrapText('x', { width: 10, indent: -1 })).toThrow(RangeError)
  })

  it('throws on negative hangingIndent', () => {
    expect(() => wrapText('x', { width: 10, hangingIndent: -2 })).toThrow(
      RangeError,
    )
  })

  it('throws on non-integer indent', () => {
    expect(() => wrapText('x', { width: 10, indent: 1.5 })).toThrow(RangeError)
  })
})

describe('wrapText — width = 0 / negative', () => {
  it('returns paragraph-split input on width = 0', () => {
    expect(wrapText('one\ntwo', { width: 0 })).toBe('one\ntwo')
  })

  it('returns paragraph-split input on negative width', () => {
    expect(wrapText('one\ntwo', { width: -3 })).toBe('one\ntwo')
  })

  it('flattens newlines on width=0 with preserveNewlines:false', () => {
    expect(wrapText('one\ntwo', { width: 0, preserveNewlines: false })).toBe(
      'one two',
    )
  })
})

describe('wrapText — ANSI escapes', () => {
  it('treats ANSI sequences as zero-width when computing wrap', () => {
    // Each word is 5 visible cells; ANSI bytes shouldn't push wrap
    const text = `${RED}hello${RESET} ${RED}world${RESET}`
    const out = wrapText(text, { width: 11 })
    // 5 + 1 + 5 = 11 cells, fits one line
    expect(out.split('\n').length).toBe(1)
  })

  it('preserves ANSI escapes through wrap', () => {
    const text = `${RED}hello${RESET} world`
    const out = wrapText(text, { width: 5 })
    // "hello" wraps to its own line because "hello world" = 11 > 5
    expect(out).toContain(RED)
    expect(out).toContain(RESET)
  })

  it('respects ANSI in width calc when used with mixed content', () => {
    const text = `${BOLD}xx${RESET} yy zzz`
    const out = wrapText(text, { width: 5 })
    // First line: "[B]xx[R] yy" = 5 visible
    expect(out.split('\n')[0]).toBe(`${BOLD}xx${RESET} yy`)
    expect(out.split('\n')[1]).toBe('zzz')
  })
})

describe('wrapText — CJK / wide glyphs', () => {
  it('counts CJK as 2 columns', () => {
    // 古 = 2 cells, 古古古 = 6 cells. width=4 → 2 chars per line.
    const out = wrapText('古 古 古', { width: 4 })
    // "古 古" = 5 cells, doesn't fit in 4. "古" alone = 2 → each line 1 char
    const lines = out.split('\n')
    expect(lines.length).toBeGreaterThanOrEqual(2)
    for (const line of lines) {
      // each line is either "古" or "古 古"; never wider than budget
      // (we already know overflow rules but no whitespace fits 2+1+2=5 in 4)
      expect(line).toMatch(/^古( 古)?$/)
    }
  })

  it('hard-breaks CJK string respecting grapheme boundary', () => {
    const out = wrapText('古古古古古', { width: 4, breakWord: true })
    const lines = out.split('\n')
    // 5 CJK = 10 cells, width 4 → 2-per-line lines
    expect(lines.every(l => l === '古古' || l === '古')).toBe(true)
    // 2+2+1 = 5 chars across 3 lines (4-cell, 4-cell, 2-cell)
    expect(lines.join('')).toBe('古古古古古')
  })

  it('does not split CJK character mid-codepoint', () => {
    const out = wrapText('hi古bye', { width: 3, breakWord: true })
    // 'hi古bye' = 7 cells. Budget 3.
    // Whichever path it takes, every line must be representable as
    // whole graphemes; in particular no half-CJK character.
    for (const line of out.split('\n')) {
      // Each line should equal its grapheme-joined self
      expect(line.length).toBeGreaterThanOrEqual(1)
    }
    // The merge-back should give us original-content order
    expect(out.replace(/\n/g, '').replace(/\s/g, '')).toBe('hi古bye')
  })
})

describe('wrapText — emoji / ZWJ sequences', () => {
  it('keeps a ZWJ emoji cluster intact under hard-break', () => {
    // 'a' + family emoji 👨‍👩‍👧 + 'b'; family is 1 grapheme width 2
    const text = 'a 👨‍👩‍👧 b'
    const out = wrapText(text, { width: 2, breakWord: true })
    // The emoji must appear intact in some line
    expect(out).toContain('👨‍👩‍👧')
  })
})

describe('wrapLines — array form', () => {
  it('returns the same lines as wrapText', () => {
    const opts = { width: 10 }
    const text = 'the quick brown fox jumps over'
    const t = wrapText(text, opts)
    const a = wrapLines(text, opts)
    expect(a).toEqual(t.split('\n'))
  })

  it('returns [\'\'] for empty input', () => {
    expect(wrapLines('', { width: 10 })).toEqual([''])
  })

  it('preserves blank paragraphs as blank entries', () => {
    expect(wrapLines('a\n\nb', { width: 10 })).toEqual(['a', '', 'b'])
  })
})

describe('wrapWithPrefix', () => {
  it('applies first/continuation prefixes to wrapped output', () => {
    const out = wrapWithPrefix('the quick brown fox jumps', {
      width: 14,
      firstPrefix: '> ',
      continuationPrefix: '> ',
    })
    // Each line should start with '> ' and inner content fits in 12
    for (const line of out.split('\n')) {
      expect(line.startsWith('> ')).toBe(true)
    }
  })

  it('honors different first vs continuation prefixes (list bullet)', () => {
    const out = wrapWithPrefix('item that wraps onto a second line', {
      width: 18,
      firstPrefix: '- ',
      continuationPrefix: '  ',
    })
    const lines = out.split('\n')
    expect(lines[0]!.startsWith('- ')).toBe(true)
    if (lines.length > 1) {
      expect(lines[1]!.startsWith('  ')).toBe(true)
      expect(lines[1]!.startsWith('- ')).toBe(false)
    }
  })

  it('degrades gracefully when prefix wider than width', () => {
    const out = wrapWithPrefix('hello world', {
      width: 3,
      firstPrefix: '>>>>>> ',
      continuationPrefix: '>>>>>> ',
    })
    // Should not throw; each prefix line emitted with 1+ cell content.
    expect(out.length).toBeGreaterThan(0)
    for (const line of out.split('\n')) {
      expect(line.startsWith('>>>>>> ')).toBe(true)
    }
  })

  it('emits prefix on a blank paragraph (just the firstPrefix)', () => {
    const out = wrapWithPrefix('a\n\nb', {
      width: 5,
      firstPrefix: '> ',
      continuationPrefix: '> ',
    })
    const lines = out.split('\n')
    expect(lines[0]).toBe('> a')
    expect(lines[1]).toBe('> ')
    expect(lines[2]).toBe('> b')
  })

  it('returns empty string on empty input', () => {
    expect(
      wrapWithPrefix('', {
        width: 10,
        firstPrefix: '> ',
        continuationPrefix: '> ',
      }),
    ).toBe('')
  })

  it('respects ANSI in prefix width calc', () => {
    const out = wrapWithPrefix('hello world bye', {
      width: 10,
      firstPrefix: `${RED}> ${RESET}`,
      continuationPrefix: `${RED}> ${RESET}`,
    })
    // Inner budget = 10 - 2 = 8 cells; ANSI shouldn't shrink it
    // 'hello world' = 11 > 8; wraps to two lines
    const lines = out.split('\n')
    expect(lines.length).toBeGreaterThanOrEqual(2)
  })
})

describe('wrapText — line-count contract', () => {
  it('never emits more lines than input characters for non-pathological case', () => {
    const out = wrapText('a b c d e f g h i j', { width: 5 })
    expect(out.split('\n').length).toBeLessThan(20)
  })

  it('does not lose words across wrap boundaries', () => {
    const out = wrapText('one two three four five', { width: 6 })
    // Reconstruct: join with space, should equal input (modulo whitespace runs)
    const reconstructed = out.split('\n').join(' ')
    expect(reconstructed).toBe('one two three four five')
  })

  it('does not lose words even with breakWord:true on overlong tokens', () => {
    const out = wrapText('hi ABCDEFGHIJ bye', { width: 4, breakWord: true })
    // Reconstruct: the line-breaks introduced by hard-splitting an
    // overlong word are pure visual breaks (no separator), while
    // word-boundary line-breaks correspond to whitespace in the input.
    // Joining lines with newlines preserved, then stripping inserted
    // newlines, must give us the original input minus internal
    // whitespace normalisation.
    expect(out.replace(/\n/g, '')).toBe('hiABCDEFGHIJbye')
    // And every visible character of the input appears in the output.
    expect(out).toMatch(/A.*B.*C.*D.*E.*F.*G.*H.*I.*J/s)
  })
})
