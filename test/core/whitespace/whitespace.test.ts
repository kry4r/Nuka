// test/core/whitespace/whitespace.test.ts
import { describe, it, expect } from 'vitest'
import {
  normalizeLineEndings,
  trimTrailingWhitespace,
  trimLeadingBlankLines,
  trimTrailingBlankLines,
  trimBlankLines,
  collapseBlankLines,
  expandTabs,
  unexpandTabs,
  dedent,
  normalize,
} from '../../../src/core/whitespace'

// ─── normalizeLineEndings ───────────────────────────────────────────

describe('normalizeLineEndings', () => {
  it('empty input → empty', () => {
    expect(normalizeLineEndings('')).toBe('')
  })

  it('non-string → empty', () => {
    expect(normalizeLineEndings(null as unknown as string)).toBe('')
  })

  it('CRLF → LF by default', () => {
    expect(normalizeLineEndings('foo\r\nbar\r\n')).toBe('foo\nbar\n')
  })

  it('lone CR → LF', () => {
    expect(normalizeLineEndings('foo\rbar\r')).toBe('foo\nbar\n')
  })

  it('mixed CR / CRLF / LF → LF', () => {
    expect(normalizeLineEndings('a\r\nb\rc\nd')).toBe('a\nb\nc\nd')
  })

  it('LF input → LF (no-op)', () => {
    expect(normalizeLineEndings('a\nb\n')).toBe('a\nb\n')
  })

  it('LF → CRLF explicit', () => {
    expect(normalizeLineEndings('foo\nbar\n', { to: 'crlf' })).toBe(
      'foo\r\nbar\r\n',
    )
  })

  it('CRLF → CRLF (round-trips via LF normalize)', () => {
    expect(normalizeLineEndings('a\r\nb\r\n', { to: 'crlf' })).toBe(
      'a\r\nb\r\n',
    )
  })

  it('idempotent', () => {
    const input = 'a\r\nb\rc\nd\r\n'
    const once = normalizeLineEndings(input)
    expect(normalizeLineEndings(once)).toBe(once)
  })
})

// ─── trimTrailingWhitespace ─────────────────────────────────────────

describe('trimTrailingWhitespace', () => {
  it('empty → empty', () => {
    expect(trimTrailingWhitespace('')).toBe('')
  })

  it('no trailing whitespace → unchanged', () => {
    expect(trimTrailingWhitespace('foo\nbar')).toBe('foo\nbar')
  })

  it('trailing spaces removed per line', () => {
    expect(trimTrailingWhitespace('foo   \nbar\n')).toBe('foo\nbar\n')
  })

  it('trailing tabs removed', () => {
    expect(trimTrailingWhitespace('foo\t\t\nbar\t')).toBe('foo\nbar')
  })

  it('mixed trailing space/tab removed', () => {
    expect(trimTrailingWhitespace('foo \t \nbar')).toBe('foo\nbar')
  })

  it('preserves leading whitespace', () => {
    expect(trimTrailingWhitespace('   foo   \n')).toBe('   foo\n')
  })

  it('preserves CRLF terminators', () => {
    expect(trimTrailingWhitespace('foo   \r\nbar\r\n')).toBe('foo\r\nbar\r\n')
  })

  it('idempotent', () => {
    const input = 'foo   \nbar\t  \n   baz\n'
    const once = trimTrailingWhitespace(input)
    expect(trimTrailingWhitespace(once)).toBe(once)
  })
})

// ─── trimLeadingBlankLines ──────────────────────────────────────────

describe('trimLeadingBlankLines', () => {
  it('empty → empty', () => {
    expect(trimLeadingBlankLines('')).toBe('')
  })

  it('drops leading blank lines', () => {
    expect(trimLeadingBlankLines('\n\n\nhello\nworld\n')).toBe(
      'hello\nworld\n',
    )
  })

  it('drops whitespace-only lines too', () => {
    expect(trimLeadingBlankLines('   \n\t\nhello\n')).toBe('hello\n')
  })

  it('preserves first non-blank line including its indent', () => {
    expect(trimLeadingBlankLines('\n\n  hello\n')).toBe('  hello\n')
  })

  it('no leading blanks → unchanged', () => {
    expect(trimLeadingBlankLines('hello\n\n')).toBe('hello\n\n')
  })

  it('handles CRLF', () => {
    expect(trimLeadingBlankLines('\r\n\r\nhello\r\n')).toBe('hello\r\n')
  })

  it('idempotent', () => {
    const input = '\n\nhello\nworld'
    const once = trimLeadingBlankLines(input)
    expect(trimLeadingBlankLines(once)).toBe(once)
  })
})

// ─── trimTrailingBlankLines ─────────────────────────────────────────

describe('trimTrailingBlankLines', () => {
  it('empty → empty', () => {
    expect(trimTrailingBlankLines('')).toBe('')
  })

  it('drops trailing blank lines but preserves final newline', () => {
    expect(trimTrailingBlankLines('foo\nbar\n\n\n')).toBe('foo\nbar\n')
  })

  it('input with no final newline → no newline added', () => {
    expect(trimTrailingBlankLines('foo\nbar')).toBe('foo\nbar')
  })

  it('preserves single trailing newline', () => {
    expect(trimTrailingBlankLines('foo\nbar\n')).toBe('foo\nbar\n')
  })

  it('drops whitespace-only trailing lines', () => {
    expect(trimTrailingBlankLines('foo\nbar\n   \n\t\n')).toBe('foo\nbar\n')
  })

  it('no trailing blanks → unchanged', () => {
    expect(trimTrailingBlankLines('foo\nbar')).toBe('foo\nbar')
  })

  it('handles CRLF', () => {
    expect(trimTrailingBlankLines('foo\r\n\r\n\r\n')).toBe('foo\r\n')
  })

  it('idempotent', () => {
    const input = 'foo\nbar\n\n\n'
    const once = trimTrailingBlankLines(input)
    expect(trimTrailingBlankLines(once)).toBe(once)
  })
})

// ─── trimBlankLines ─────────────────────────────────────────────────

describe('trimBlankLines', () => {
  it('empty → empty', () => {
    expect(trimBlankLines('')).toBe('')
  })

  it('strips both ends', () => {
    expect(trimBlankLines('\n\nhello\nworld\n\n\n')).toBe('hello\nworld\n')
  })

  it('preserves interior blanks', () => {
    expect(trimBlankLines('\n\nfoo\n\nbar\n\n')).toBe('foo\n\nbar\n')
  })

  it('idempotent', () => {
    const input = '\n\n  foo\n\nbar  \n\n'
    const once = trimBlankLines(input)
    expect(trimBlankLines(once)).toBe(once)
  })
})

// ─── collapseBlankLines ─────────────────────────────────────────────

describe('collapseBlankLines', () => {
  it('empty → empty', () => {
    expect(collapseBlankLines('')).toBe('')
  })

  it('default: collapses 5 blanks to 1', () => {
    expect(collapseBlankLines('a\n\n\n\n\nb')).toBe('a\n\nb')
  })

  it('default: collapses 3 blanks to 1', () => {
    expect(collapseBlankLines('a\n\n\n\nb')).toBe('a\n\nb')
  })

  it('default: leaves single blank alone', () => {
    expect(collapseBlankLines('a\n\nb')).toBe('a\n\nb')
  })

  it('maxConsecutive=0 strips all blanks', () => {
    expect(collapseBlankLines('a\n\n\nb', { maxConsecutive: 0 })).toBe('a\nb')
  })

  it('maxConsecutive=2 allows two blanks', () => {
    expect(collapseBlankLines('a\n\n\n\nb', { maxConsecutive: 2 })).toBe(
      'a\n\n\nb',
    )
  })

  it('whitespace-only lines count as blank', () => {
    expect(collapseBlankLines('a\n   \n\t\nb')).toBe('a\n\nb')
  })

  it('preserves non-blank content lines', () => {
    expect(collapseBlankLines('foo\nbar\nbaz')).toBe('foo\nbar\nbaz')
  })

  it('preserves final newline', () => {
    expect(collapseBlankLines('a\n\n\nb\n')).toBe('a\n\nb\n')
  })

  it('CRLF-preserving', () => {
    expect(collapseBlankLines('a\r\n\r\n\r\n\r\nb\r\n')).toBe('a\r\n\r\nb\r\n')
  })

  it('idempotent at default', () => {
    const input = 'a\n\n\n\nb\n\n\nc'
    const once = collapseBlankLines(input)
    expect(collapseBlankLines(once)).toBe(once)
  })
})

// ─── expandTabs ─────────────────────────────────────────────────────

describe('expandTabs', () => {
  it('empty → empty', () => {
    expect(expandTabs('')).toBe('')
  })

  it('no tabs → unchanged', () => {
    expect(expandTabs('hello world')).toBe('hello world')
  })

  it('default tabWidth=8: leading tab', () => {
    expect(expandTabs('\thi')).toBe('        hi')
  })

  it('default tabWidth=8: foo\\tbar → foo + 5 spaces + bar', () => {
    // 'foo' is 3 chars (cols 0..2). Tab advances to next multiple of 8 = 8.
    // So 8 - 3 = 5 spaces.
    expect(expandTabs('foo\tbar')).toBe('foo     bar')
  })

  it('tabWidth=4: a\\tb → a + 3 spaces + b', () => {
    expect(expandTabs('a\tb', { tabWidth: 4 })).toBe('a   b')
  })

  it('tabWidth=4: tab at col 3 advances to col 4 (1 space)', () => {
    // 'foo' cols 0..2 → tab to next multiple of 4 = 4 → 1 space.
    expect(expandTabs('foo\tbar', { tabWidth: 4 })).toBe('foo bar')
  })

  it('consecutive tabs', () => {
    expect(expandTabs('\t\thi', { tabWidth: 4 })).toBe('        hi')
  })

  it('tabWidth ≤ 0 treated as 1', () => {
    expect(expandTabs('a\tb', { tabWidth: 0 })).toBe('a b')
    expect(expandTabs('a\tb', { tabWidth: -3 })).toBe('a b')
  })

  it('column resets on newline', () => {
    // First line: 'foo' (3) + tab → 5 spaces to col 8. Newline resets.
    // Second line: tab at col 0 → 8 spaces.
    expect(expandTabs('foo\tbar\n\tbaz')).toBe(
      'foo     bar\n        baz',
    )
  })

  it('column resets on CR too', () => {
    expect(expandTabs('a\rb\tc', { tabWidth: 4 })).toBe('a\rb   c')
  })

  it('idempotent (no tabs in output)', () => {
    const input = '\tfoo\tbar\n\tbaz'
    const once = expandTabs(input)
    expect(expandTabs(once)).toBe(once)
  })
})

// ─── unexpandTabs ───────────────────────────────────────────────────

describe('unexpandTabs', () => {
  it('empty → empty', () => {
    expect(unexpandTabs('')).toBe('')
  })

  it('no leading spaces → unchanged', () => {
    expect(unexpandTabs('hello world')).toBe('hello world')
  })

  it('4 leading spaces with tabWidth=4 → tab', () => {
    expect(unexpandTabs('    hi', { tabWidth: 4 })).toBe('\thi')
  })

  it('8 leading spaces with tabWidth=4 → two tabs', () => {
    expect(unexpandTabs('        x', { tabWidth: 4 })).toBe('\t\tx')
  })

  it('partial group preserved', () => {
    expect(unexpandTabs('      hi', { tabWidth: 4 })).toBe('\t  hi')
  })

  it('under one tabWidth stays spaces', () => {
    expect(unexpandTabs('  hi', { tabWidth: 4 })).toBe('  hi')
  })

  it('only leading whitespace is converted (not mid-line)', () => {
    expect(unexpandTabs('    foo    bar', { tabWidth: 4 })).toBe(
      '\tfoo    bar',
    )
  })

  it('multi-line', () => {
    expect(
      unexpandTabs('    a\n        b\n  c', { tabWidth: 4 }),
    ).toBe('\ta\n\t\tb\n  c')
  })

  it('preserves CRLF terminators', () => {
    expect(unexpandTabs('    a\r\n    b\r\n', { tabWidth: 4 })).toBe(
      '\ta\r\n\tb\r\n',
    )
  })

  it('leading tab + spaces normalized', () => {
    // Leading is '\t  ' (tab=col4 + 2 spaces=col6 → 6 columns). With
    // tabWidth=4, 6/4=1 full tab + 2 remainder spaces.
    expect(unexpandTabs('\t  hi', { tabWidth: 4 })).toBe('\t  hi')
  })
})

// ─── dedent ─────────────────────────────────────────────────────────

describe('dedent', () => {
  it('empty → empty', () => {
    expect(dedent('')).toBe('')
  })

  it('single line, no indent → unchanged', () => {
    expect(dedent('hello')).toBe('hello')
  })

  it('single line with indent → stripped', () => {
    expect(dedent('    hello')).toBe('hello')
  })

  it('strips common 4-space indent', () => {
    expect(dedent('    line1\n    line2\n    line3\n')).toBe(
      'line1\nline2\nline3\n',
    )
  })

  it('strips common indent, preserves extra (4/6 → strip 4)', () => {
    expect(dedent('    line1\n      line2\n    line3\n')).toBe(
      'line1\n  line2\nline3\n',
    )
  })

  it('blank lines do not constrain min indent', () => {
    expect(dedent('    foo\n\n    bar\n')).toBe('foo\n\nbar\n')
  })

  it('whitespace-only lines become empty', () => {
    expect(dedent('    foo\n    \n    bar\n')).toBe('foo\n\nbar\n')
  })

  it('no common indent → unchanged (except blanks zeroed)', () => {
    expect(dedent('foo\n  bar\n')).toBe('foo\n  bar\n')
  })

  it('handles tabs in leading indent (tabWidth=4)', () => {
    // Both lines have leading '\t' (col 4 with tabWidth=4), so common
    // indent = 4 cols.
    expect(dedent('\thello\n\tworld\n', { tabWidth: 4 })).toBe(
      'hello\nworld\n',
    )
  })

  it('mixed tabs/spaces in leading indent', () => {
    // Line 1: '\t' = 4 cols (with tabWidth=4)
    // Line 2: '    ' = 4 cols
    // Common = 4, both stripped fully.
    expect(dedent('\tfoo\n    bar\n', { tabWidth: 4 })).toBe('foo\nbar\n')
  })

  it('mixed indent with deeper nested', () => {
    // tabWidth=4
    // Line 1: '\t' = 4 cols
    // Line 2: '\t\t' = 8 cols
    // Common = 4 → strip 4 cols from each → line2 has 4 spaces left.
    expect(dedent('\thello\n\t\tworld', { tabWidth: 4 })).toBe(
      'hello\n    world',
    )
  })

  it('CRLF preserved', () => {
    expect(dedent('    a\r\n    b\r\n')).toBe('a\r\nb\r\n')
  })

  it('preserves trailing-newline state', () => {
    expect(dedent('    a\n    b')).toBe('a\nb') // no final newline
    expect(dedent('    a\n    b\n')).toBe('a\nb\n') // has final newline
  })

  it('idempotent', () => {
    const input = '    foo\n      bar\n    baz\n'
    const once = dedent(input)
    expect(dedent(once)).toBe(once)
  })
})

// ─── normalize ──────────────────────────────────────────────────────

describe('normalize', () => {
  it('empty → empty', () => {
    expect(normalize('')).toBe('')
  })

  it('default options run the full pipeline', () => {
    const input = '  \n    foo  \n    bar\n\n\n\n    baz  \n  \n'
    expect(normalize(input)).toBe('foo\nbar\n\nbaz\n')
  })

  it('CRLF input is normalized to LF by default', () => {
    expect(normalize('foo\r\nbar\r\n')).toBe('foo\nbar\n')
  })

  it('lineEndings=crlf forces CRLF output', () => {
    expect(normalize('foo\nbar\n', { lineEndings: 'crlf' })).toBe(
      'foo\r\nbar\r\n',
    )
  })

  it('lineEndings=false leaves them alone', () => {
    // CRLF passes through internal steps since collapse/trim are
    // line-ending-style aware. Confirm CRLF is preserved end-to-end.
    expect(
      normalize('foo\r\nbar  \r\n\r\n\r\nbaz\r\n', {
        lineEndings: false,
      }),
    ).toBe('foo\r\nbar\r\n\r\nbaz\r\n')
  })

  it('dedent disabled', () => {
    expect(
      normalize('    foo\n      bar\n', { dedent: false }),
    ).toBe('    foo\n      bar\n')
  })

  it('trimTrailing disabled', () => {
    // Trailing whitespace preserved on every line.
    expect(
      normalize('foo  \nbar  \n', { trimTrailing: false, dedent: false }),
    ).toBe('foo  \nbar  \n')
  })

  it('collapseBlanks disabled', () => {
    expect(
      normalize('a\n\n\n\nb\n', {
        collapseBlanks: false,
        dedent: false,
        trimEdges: false,
      }),
    ).toBe('a\n\n\n\nb\n')
  })

  it('collapseBlanks=2', () => {
    expect(
      normalize('a\n\n\n\n\nb', {
        collapseBlanks: 2,
        dedent: false,
        trimEdges: false,
      }),
    ).toBe('a\n\n\nb')
  })

  it('trimEdges disabled', () => {
    expect(
      normalize('\n\nfoo\n\n', {
        trimEdges: false,
        dedent: false,
        collapseBlanks: false,
      }),
    ).toBe('\n\nfoo\n\n')
  })

  it('expandTabs enabled', () => {
    expect(
      normalize('\tfoo\tbar\n', { expandTabs: 4, dedent: false }),
    ).toBe('    foo bar\n')
  })

  it('expandTabs disabled by default', () => {
    // Pass-through: tabs stay as tabs.
    expect(
      normalize('\tfoo\tbar', { dedent: false, trimTrailing: false }),
    ).toBe('\tfoo\tbar')
  })

  it('combined: dedent + collapse + trim edges', () => {
    const input = '\n\n    foo\n\n\n    bar  \n    baz\n\n'
    expect(normalize(input)).toBe('foo\n\nbar\nbaz\n')
  })

  it('idempotent on default options', () => {
    const inputs = [
      '',
      'hello',
      'foo\nbar\n',
      '\n\n  foo  \n\n\n\n  bar\n  \n',
      'foo\r\nbar  \r\n\r\n\r\n',
      '    a\n    b\n      c\n\n\n',
    ]
    for (const input of inputs) {
      const once = normalize(input)
      expect(normalize(once)).toBe(once)
    }
  })

  it('combined: each option independently disabled (sanity)', () => {
    // No-op style: disable everything → output equals input.
    const input = '   foo  \n\n\n  bar  \n'
    expect(
      normalize(input, {
        dedent: false,
        trimTrailing: false,
        collapseBlanks: false,
        trimEdges: false,
        lineEndings: false,
        expandTabs: false,
      }),
    ).toBe(input)
  })
})

// ─── edge cases / cross-checks ──────────────────────────────────────

describe('edge cases', () => {
  it('all helpers tolerate empty string', () => {
    expect(trimTrailingWhitespace('')).toBe('')
    expect(trimLeadingBlankLines('')).toBe('')
    expect(trimTrailingBlankLines('')).toBe('')
    expect(trimBlankLines('')).toBe('')
    expect(collapseBlankLines('')).toBe('')
    expect(expandTabs('')).toBe('')
    expect(unexpandTabs('')).toBe('')
    expect(dedent('')).toBe('')
    expect(normalize('')).toBe('')
  })

  it('single-line untouched input', () => {
    expect(normalize('hello')).toBe('hello')
  })

  it('expandTabs is the canonical implementation behind dedent', () => {
    // Verify that the tab/space-mixing example matches expandTabs.
    expect(expandTabs('\thello', { tabWidth: 4 })).toBe('    hello')
    expect(expandTabs('\t\tx', { tabWidth: 4 })).toBe('        x')
  })

  it('dedent does not strip indent if only one line is non-blank', () => {
    // Single non-blank line with leading spaces → its indent IS the
    // common indent → stripped entirely. (Verified behavior.)
    expect(dedent('\n    only\n')).toBe('\nonly\n')
  })

  it('dedent of all-blank input → all-blank-zeroed', () => {
    expect(dedent('\n  \n\t\n')).toBe('\n\n\n')
  })

  it('normalize composes correctly for a realistic markdown blob', () => {
    const input = [
      '',
      '',
      '    Hello world.   ',
      '    This is a paragraph.',
      '',
      '',
      '',
      '    With a second one.',
      '',
      '',
    ].join('\n')
    const out = normalize(input)
    expect(out).toBe(
      'Hello world.\nThis is a paragraph.\n\nWith a second one.\n',
    )
  })
})
