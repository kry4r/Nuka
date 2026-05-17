// test/core/textStats/textStats.test.ts
import { describe, it, expect } from 'vitest'
import {
  textStats,
  countLines,
  countWords,
  countSentences,
  countParagraphs,
  type TextStats,
} from '../../../src/core/textStats'

// Build ANSI sequences as runtime strings rather than literal escapes
// to keep this file editable in a wider range of editors.
const ESC = ''
const RED = `${ESC}[31m`
const RESET = `${ESC}[0m`

describe('textStats — empty / whitespace edge cases', () => {
  it('empty string → all zeros', () => {
    const s = textStats('')
    const zero: TextStats = {
      chars: 0,
      visualWidth: 0,
      bytes: 0,
      lines: 0,
      words: 0,
      sentences: 0,
      paragraphs: 0,
      avgLineLength: 0,
      avgWordLength: 0,
      avgWordsPerSentence: 0,
    }
    expect(s).toEqual(zero)
  })

  it('null / undefined input behaves like empty', () => {
    expect(textStats(null as unknown as string).chars).toBe(0)
    expect(textStats(undefined as unknown as string).bytes).toBe(0)
  })

  it('whitespace-only string has bytes/chars/lines but 0 words and 0 sentences', () => {
    const s = textStats('   ')
    expect(s.chars).toBe(3)
    expect(s.bytes).toBe(3)
    expect(s.words).toBe(0)
    expect(s.sentences).toBe(0)
    expect(s.paragraphs).toBe(0)
    expect(s.lines).toBe(1) // single line of just spaces
    expect(s.avgWordLength).toBe(0)
    expect(s.avgWordsPerSentence).toBe(0)
  })

  it('whitespace-only with newlines → still 0 paragraphs', () => {
    const s = textStats('\n\n  \t\n')
    expect(s.words).toBe(0)
    expect(s.sentences).toBe(0)
    expect(s.paragraphs).toBe(0)
  })
})

describe('textStats — single word / single line', () => {
  it('single word, no newline', () => {
    const s = textStats('hello')
    expect(s.chars).toBe(5)
    expect(s.bytes).toBe(5)
    expect(s.visualWidth).toBe(5)
    expect(s.words).toBe(1)
    expect(s.lines).toBe(1)
    expect(s.sentences).toBe(1) // fallback: non-empty body
    expect(s.paragraphs).toBe(1)
    expect(s.avgLineLength).toBe(5)
    expect(s.avgWordLength).toBe(5)
    expect(s.avgWordsPerSentence).toBe(1)
  })

  it('single sentence with period', () => {
    const s = textStats('Hello world.')
    expect(s.words).toBe(2)
    expect(s.sentences).toBe(1)
    expect(s.avgWordsPerSentence).toBe(2)
  })
})

describe('textStats — line counting', () => {
  it('trailing newline is a terminator, not a new line', () => {
    expect(countLines('a\n')).toBe(1)
    expect(countLines('a\nb\n')).toBe(2)
  })

  it('no trailing newline counts the partial line', () => {
    expect(countLines('a')).toBe(1)
    expect(countLines('a\nb')).toBe(2)
    expect(countLines('a\nb\nc')).toBe(3)
  })

  it('handles CRLF and lone CR', () => {
    expect(countLines('a\r\nb\r\n')).toBe(2)
    expect(countLines('a\rb\r')).toBe(2)
    expect(countLines('a\r\nb')).toBe(2)
  })

  it('empty lines between content', () => {
    expect(countLines('a\n\nb')).toBe(3)
    expect(countLines('a\n\n\nb')).toBe(4)
  })

  it('lines on textStats matches countLines', () => {
    expect(textStats('line1\nline2\n').lines).toBe(2)
    expect(textStats('line1\nline2').lines).toBe(2)
    expect(textStats('').lines).toBe(0)
  })
})

describe('textStats — word counting', () => {
  it('multiple consecutive spaces collapse to one separator', () => {
    expect(countWords('hello    world')).toBe(2)
    expect(countWords('  hello   world  ')).toBe(2)
  })

  it('mixed whitespace (tabs, newlines) treated as separators', () => {
    expect(countWords('hello\tworld\nbye')).toBe(3)
  })

  it('words with punctuation count as one word', () => {
    expect(countWords("it's a test, isn't it?")).toBe(5)
  })

  it('empty / whitespace-only returns 0', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('   ')).toBe(0)
    expect(countWords('\n\n')).toBe(0)
  })

  it('avgWordLength excludes whitespace', () => {
    const s = textStats('aa bb cc')
    expect(s.words).toBe(3)
    expect(s.avgWordLength).toBe(2) // 6 non-ws chars / 3 words
  })
})

describe('textStats — sentence counting', () => {
  it('three sentences with different terminators', () => {
    expect(countSentences('Hi. Hello! Howdy?')).toBe(3)
  })

  it('trailing punctuation without space still terminates at EOF', () => {
    expect(countSentences('One. Two.')).toBe(2)
    expect(countSentences('Single sentence.')).toBe(1)
  })

  it('ellipses count as one terminator, not three', () => {
    expect(countSentences('Wait... what?')).toBe(2)
    expect(countSentences('Wait...')).toBe(1)
  })

  it('decimal numbers do not inflate sentence count', () => {
    expect(countSentences('Pi is 3.14 in math.')).toBe(1)
    expect(countSentences('Use 3.14 and 2.71.')).toBe(1)
  })

  it('abbreviations DO inflate (documented limitation)', () => {
    // `Mr. Smith said hi.` — `.` after `Mr` is followed by space, so
    // it's classified as a sentence boundary.
    expect(countSentences('Mr. Smith said hi.')).toBe(2)
  })

  it('non-empty body with no terminal punctuation counts as 1', () => {
    expect(countSentences('hello world')).toBe(1)
    expect(countSentences('one two three')).toBe(1)
  })

  it('empty / whitespace-only returns 0', () => {
    expect(countSentences('')).toBe(0)
    expect(countSentences('   \n  ')).toBe(0)
  })

  it('mixed terminator runs', () => {
    expect(countSentences('Really?! Yes.')).toBe(2)
  })
})

describe('textStats — paragraph counting', () => {
  it('blank-line separator creates a new paragraph', () => {
    expect(countParagraphs('para one\n\npara two')).toBe(2)
    expect(countParagraphs('para one\n\npara two\n\npara three')).toBe(3)
  })

  it('multiple consecutive blank lines count as one separator', () => {
    expect(countParagraphs('one\n\n\n\ntwo')).toBe(2)
  })

  it('trailing blank lines do not create empty paragraphs', () => {
    expect(countParagraphs('only para\n\n\n')).toBe(1)
  })

  it('whitespace-only "blank" lines are blank', () => {
    expect(countParagraphs('one\n  \ntwo')).toBe(2)
    expect(countParagraphs('one\n\t\ntwo')).toBe(2)
  })

  it('no blank lines = 1 paragraph', () => {
    expect(countParagraphs('line one\nline two\nline three')).toBe(1)
  })

  it('empty / whitespace-only returns 0', () => {
    expect(countParagraphs('')).toBe(0)
    expect(countParagraphs('\n\n\n')).toBe(0)
  })

  it('handles CRLF separators', () => {
    expect(countParagraphs('a\r\n\r\nb')).toBe(2)
  })
})

describe('textStats — unicode / bytes', () => {
  it('CJK chars: 1 char each, 2 visual cells, 3 UTF-8 bytes', () => {
    const s = textStats('你好世界')
    expect(s.chars).toBe(4)
    expect(s.visualWidth).toBe(8) // 4 fullwidth glyphs × 2 cells
    expect(s.bytes).toBe(12) // 4 × 3 bytes UTF-8
  })

  it('emoji as one grapheme — chars counts UTF-16 code units', () => {
    // 👋 is U+1F44B, encoded as a surrogate pair → 2 UTF-16 units,
    // 1 grapheme, width 2, 4 UTF-8 bytes.
    const s = textStats('Hi 👋')
    expect(s.chars).toBe(5) // 'H' + 'i' + ' ' + 2 surrogate halves
    expect(s.visualWidth).toBe(5) // 'Hi ' (3) + emoji (2)
    expect(s.bytes).toBe(7) // 3 ASCII + 4 emoji
    expect(s.words).toBe(2)
  })

  it('bytes counts the raw UTF-8 encoding', () => {
    expect(textStats('a').bytes).toBe(1)
    expect(textStats('£').bytes).toBe(2) // U+00A3 — 2 bytes
    expect(textStats('€').bytes).toBe(3) // U+20AC — 3 bytes
    expect(textStats('𝓗').bytes).toBe(4) // U+1D4D7 — 4 bytes
  })

  it('mixed ASCII / non-ASCII bytes', () => {
    // 'café' = c(1) + a(1) + f(1) + é(2) = 5 bytes
    expect(textStats('café').bytes).toBe(5)
  })
})

describe('textStats — ANSI escapes', () => {
  it('default: ANSI stripped from chars and visualWidth', () => {
    // `[31mred[0m` — visible 'red'
    const s = textStats(`${RED}red${RESET}`)
    expect(s.chars).toBe(3)
    expect(s.visualWidth).toBe(3)
    expect(s.words).toBe(1)
  })

  it('bytes always reflects the original input (with ANSI bytes)', () => {
    const raw = `${RED}red${RESET}`
    const s = textStats(raw)
    // The raw string is pure ASCII so chars-of-raw equals bytes.
    expect(s.bytes).toBe(raw.length)
    expect(s.bytes).toBeGreaterThan(s.chars)
  })

  it('countAnsi: true counts ANSI as literal chars', () => {
    const s = textStats(`${RED}red${RESET}`, { countAnsi: true })
    // String length includes the ANSI bytes — every byte counts.
    expect(s.chars).toBe(`${RED}red${RESET}`.length)
  })

  it('countLines ignores ANSI line content by default', () => {
    expect(countLines(`${RED}line${RESET}`)).toBe(1)
  })
})

describe('textStats — tab handling', () => {
  it('tabs default to width 8', () => {
    const s = textStats('a\tb')
    expect(s.visualWidth).toBe(10) // 'a' + tab(8) + 'b'
  })

  it('custom tabWidth honored', () => {
    expect(textStats('a\tb', { tabWidth: 4 }).visualWidth).toBe(6)
    expect(textStats('a\tb', { tabWidth: 2 }).visualWidth).toBe(4)
  })

  it('tab counts as 1 char but contributes width 8', () => {
    const s = textStats('\t')
    expect(s.chars).toBe(1)
    expect(s.visualWidth).toBe(8)
  })
})

describe('textStats — multi-line averages', () => {
  it('avgLineLength excludes terminators', () => {
    const s = textStats('hello\nworld\n')
    expect(s.lines).toBe(2)
    expect(s.avgLineLength).toBe(5) // 10 non-newline chars / 2 lines
  })

  it('avgLineLength on uneven lines', () => {
    const s = textStats('aaa\nbb')
    expect(s.lines).toBe(2)
    expect(s.avgLineLength).toBe(2.5) // 5 / 2
  })

  it('avgWordsPerSentence', () => {
    const s = textStats('Hi there. How are you?')
    expect(s.sentences).toBe(2)
    expect(s.words).toBe(5)
    expect(s.avgWordsPerSentence).toBe(2.5)
  })
})

describe('textStats — performance / linearity', () => {
  it('handles a 1 MB string without slowdown', () => {
    // A naive `O(n²)` implementation would take seconds on 1 MB; the
    // linear path finishes in single-digit ms. Test by ensuring we
    // return before a generous deadline.
    const block = 'lorem ipsum dolor sit amet. '.repeat(40_000) // ~1.1 MB
    const start = Date.now()
    const s = textStats(block)
    const elapsed = Date.now() - start
    expect(s.words).toBeGreaterThan(100_000)
    expect(s.sentences).toBeGreaterThan(30_000)
    expect(elapsed).toBeLessThan(2_000)
  })
})

describe('textStats — multi-line full integration', () => {
  it('paragraph with sentences, trailing newline', () => {
    const s = textStats('Hello world. This is fine.\n\nNew paragraph here.\n')
    expect(s.lines).toBe(3)
    expect(s.paragraphs).toBe(2)
    expect(s.sentences).toBe(3)
    expect(s.words).toBe(8)
  })

  it('paragraph with sentences, no trailing newline', () => {
    const s = textStats('Hello world. This is fine.\n\nNew paragraph here.')
    expect(s.lines).toBe(3)
    expect(s.paragraphs).toBe(2)
    expect(s.sentences).toBe(3)
    expect(s.words).toBe(8)
  })

  it('CJK paragraph: bytes ≫ chars, visualWidth = 2 × chars', () => {
    const s = textStats('你好世界\n再见')
    expect(s.chars).toBe(7) // 4 + 1 newline + 2
    expect(s.visualWidth).toBe(12) // 8 + 0(newline) + 4
    expect(s.bytes).toBe(19) // 6 CJK × 3 + 1 newline
    expect(s.lines).toBe(2)
    expect(s.words).toBe(2)
  })
})
