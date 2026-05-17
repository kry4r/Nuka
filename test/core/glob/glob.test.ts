// test/core/glob/glob.test.ts
//
// Tests for `src/core/glob`. All edge cases listed in the porting spec
// (PR description) get a corresponding `it()` here. Group by feature
// area for readability — the matcher is small enough that a flat
// suite would have worked, but this layout makes failures easier to
// localise when something regresses.

import { describe, it, expect } from 'vitest'
import {
  compileGlob,
  matchesGlob,
  globToRegex,
  expandBraces,
} from '../../../src/core/glob'

describe('matchesGlob — literal patterns (no wildcards)', () => {
  it('matches an exact filename', () => {
    expect(matchesGlob('foo.txt', 'foo.txt')).toBe(true)
  })
  it('does not match a different filename', () => {
    expect(matchesGlob('foo.txt', 'bar.txt')).toBe(false)
  })
  it('does not match a path that contains the filename in another segment', () => {
    expect(matchesGlob('foo.txt', 'dir/foo.txt')).toBe(false)
  })
})

describe('matchesGlob — single-segment `*`', () => {
  it('matches anything in a single path segment', () => {
    expect(matchesGlob('*.ts', 'foo.ts')).toBe(true)
  })
  it('does not match when extension differs', () => {
    expect(matchesGlob('*.ts', 'foo.txt')).toBe(false)
  })
  it('does NOT cross segments — `*.ts` must not match `dir/foo.ts`', () => {
    expect(matchesGlob('*.ts', 'dir/foo.ts')).toBe(false)
  })
  it('matches an empty extension target only when pattern allows', () => {
    // `*` with no trailing extension matches a segment of any non-empty
    // length but NOT a dotfile by default (separate test below).
    expect(matchesGlob('*', 'foo')).toBe(true)
    expect(matchesGlob('*', '')).toBe(false)
  })
})

describe('matchesGlob — globstar `**`', () => {
  it('matches across path segments', () => {
    expect(matchesGlob('**/*.ts', 'a/b/c.ts')).toBe(true)
  })
  it('matches at top level too (no intervening segment)', () => {
    expect(matchesGlob('**/*.ts', 'foo.ts')).toBe(true)
  })
  it('bare `**` matches every path', () => {
    expect(matchesGlob('**', 'a/b/c')).toBe(true)
    expect(matchesGlob('**', 'single')).toBe(true)
  })
})

describe('matchesGlob — `?` single character', () => {
  it('matches exactly one non-slash character', () => {
    expect(matchesGlob('f?o', 'foo')).toBe(true)
  })
  it('does not match more than one character', () => {
    expect(matchesGlob('f?o', 'fooo')).toBe(false)
  })
  it('does not match a slash', () => {
    expect(matchesGlob('f?o', 'f/o')).toBe(false)
  })
})

describe('matchesGlob — leading-`/` root anchor', () => {
  it('matches a top-level path', () => {
    expect(matchesGlob('/foo', 'foo')).toBe(true)
  })
  it('does NOT match a same-name path nested under another directory', () => {
    expect(matchesGlob('/foo', 'bar/foo')).toBe(false)
  })
})

describe('matchesGlob — trailing-`/` directory marker', () => {
  it('matches a file inside the directory', () => {
    expect(matchesGlob('foo/', 'foo/anything')).toBe(true)
  })
  it('matches a nested file inside the directory', () => {
    expect(matchesGlob('foo/', 'foo/sub/leaf')).toBe(true)
  })
})

describe('matchesGlob — dotfile handling', () => {
  it('`*` does NOT match a dotfile by default', () => {
    expect(matchesGlob('*', '.hidden')).toBe(false)
  })
  it('`*` matches a dotfile when `dot: true`', () => {
    expect(matchesGlob('*', '.hidden', { dot: true })).toBe(true)
  })
  it('explicit `.` prefix matches a dotfile without the flag', () => {
    expect(matchesGlob('.*', '.hidden')).toBe(true)
  })
})

describe('matchesGlob — case sensitivity', () => {
  it('is case-sensitive by default', () => {
    expect(matchesGlob('*.TXT', 'foo.txt')).toBe(false)
  })
  it('matches case-insensitively when opt is set', () => {
    expect(matchesGlob('*.TXT', 'foo.txt', { caseInsensitive: true })).toBe(true)
    expect(matchesGlob('FOO.txt', 'foo.txt', { caseInsensitive: true })).toBe(true)
  })
})

describe('matchesGlob — empty / degenerate inputs', () => {
  it('empty pattern matches only empty path', () => {
    expect(matchesGlob('', '')).toBe(true)
    expect(matchesGlob('', 'foo')).toBe(false)
  })
  it('non-empty pattern does not match empty path', () => {
    expect(matchesGlob('foo', '')).toBe(false)
  })
  it('pure `/` pattern degrades to match-all', () => {
    expect(matchesGlob('/', 'anything')).toBe(true)
    expect(matchesGlob('/', 'a/b/c')).toBe(true)
  })
})

describe('matchesGlob — brace alternation', () => {
  it('matches the first alternative', () => {
    expect(matchesGlob('a.{js,ts}', 'a.js')).toBe(true)
  })
  it('matches the second alternative', () => {
    expect(matchesGlob('a.{js,ts}', 'a.ts')).toBe(true)
  })
  it('does not match a non-listed extension', () => {
    expect(matchesGlob('a.{js,ts}', 'a.py')).toBe(false)
  })
})

describe('matchesGlob — character classes', () => {
  it('matches any single character in the class', () => {
    expect(matchesGlob('[abc].txt', 'a.txt')).toBe(true)
    expect(matchesGlob('[abc].txt', 'b.txt')).toBe(true)
    expect(matchesGlob('[abc].txt', 'c.txt')).toBe(true)
  })
  it('does not match a character outside the class', () => {
    expect(matchesGlob('[abc].txt', 'd.txt')).toBe(false)
  })
})

describe('matchesGlob — escapes', () => {
  // In a JS string literal, `\\*` is the two-character pattern
  // backslash-star, which picomatch reads as "literal star".
  it('`\\*` matches a literal asterisk', () => {
    expect(matchesGlob('\\*', '*')).toBe(true)
  })
  it('`\\*` does NOT match an arbitrary character', () => {
    expect(matchesGlob('\\*', 'a')).toBe(false)
  })
  it('`\\?` matches a literal question mark', () => {
    expect(matchesGlob('\\?', '?')).toBe(true)
  })
})

describe('matchesGlob — leading-`!` negation', () => {
  it('negates a positive match', () => {
    expect(matchesGlob('!*.ts', 'foo.ts')).toBe(false)
  })
  it('passes through non-matching paths', () => {
    expect(matchesGlob('!*.ts', 'foo.txt')).toBe(true)
  })
})

describe('matchesGlob — input validation', () => {
  it('treats non-string path as "no match"', () => {
    // The matcher must not throw on bad caller input; that's a hard
    // contract for any predicate consumers can wrap directly.
    expect(matchesGlob('*.ts', undefined as unknown as string)).toBe(false)
    expect(matchesGlob('*.ts', null as unknown as string)).toBe(false)
    expect(matchesGlob('*.ts', 42 as unknown as string)).toBe(false)
  })
  it('throws TypeError on non-string pattern', () => {
    expect(() => matchesGlob(42 as unknown as string, 'foo')).toThrow(TypeError)
  })
})

describe('compileGlob — reuse', () => {
  it('returns a matcher that can be invoked many times', () => {
    const m = compileGlob('*.ts')
    expect(m.test('a.ts')).toBe(true)
    expect(m.test('b.ts')).toBe(true)
    expect(m.test('c.txt')).toBe(false)
  })
  it('exposes a non-empty regex source', () => {
    const m = compileGlob('*.ts')
    expect(typeof m.source).toBe('string')
    expect(m.source.length).toBeGreaterThan(0)
    // The compiled regex should anchor to start/end.
    expect(m.source.startsWith('^')).toBe(true)
    expect(m.source.endsWith('$')).toBe(true)
  })
  it('empty pattern returns a stable matcher with a defined source', () => {
    const m = compileGlob('')
    expect(m.test('')).toBe(true)
    expect(m.test('x')).toBe(false)
    expect(typeof m.source).toBe('string')
    expect(m.source.length).toBeGreaterThan(0)
  })
})

describe('globToRegex', () => {
  it('returns a RegExp instance', () => {
    expect(globToRegex('*.ts')).toBeInstanceOf(RegExp)
  })
  it('regex matches the same paths the matcher does', () => {
    const re = globToRegex('*.ts')
    expect(re.test('foo.ts')).toBe(true)
    expect(re.test('foo.txt')).toBe(false)
  })
  it('empty pattern returns `/^$/`', () => {
    const re = globToRegex('')
    expect(re.test('')).toBe(true)
    expect(re.test('anything')).toBe(false)
  })
  it('honours caseInsensitive opt', () => {
    const re = globToRegex('*.TS', { caseInsensitive: true })
    expect(re.test('foo.ts')).toBe(true)
    expect(re.test('foo.TS')).toBe(true)
  })
  it('rejects non-string pattern', () => {
    expect(() => globToRegex(undefined as unknown as string)).toThrow(TypeError)
  })
})

describe('expandBraces', () => {
  it('no braces → single-element array equal to input', () => {
    expect(expandBraces('no.braces')).toEqual(['no.braces'])
  })
  it('empty pattern → array with one empty string', () => {
    expect(expandBraces('')).toEqual([''])
  })
  it('simple two-way alternation', () => {
    expect(expandBraces('a.{js,ts}').sort()).toEqual(['a.js', 'a.ts'])
  })
  it('three-way alternation', () => {
    expect(expandBraces('{a,b,c}').sort()).toEqual(['a', 'b', 'c'])
  })
  it('expansion preserves a separator after the brace group', () => {
    expect(expandBraces('a/{b,c}/d').sort()).toEqual(['a/b/d', 'a/c/d'])
  })
  it('two adjacent brace groups multiply (cartesian product)', () => {
    const got = expandBraces('a/{b,c}/{x,y}').sort()
    expect(got).toEqual(['a/b/x', 'a/b/y', 'a/c/x', 'a/c/y'])
  })
  it('nested braces expand inside-out', () => {
    expect(expandBraces('{a,b{c,d}}').sort()).toEqual(['a', 'bc', 'bd'])
  })
  it('unbalanced opening brace is preserved as literal', () => {
    expect(expandBraces('a{b,c')).toEqual(['a{b,c'])
  })
  it('unbalanced closing brace is preserved as literal', () => {
    expect(expandBraces('a}b,c')).toEqual(['a}b,c'])
  })
  it('singleton brace strips the braces', () => {
    expect(expandBraces('a.{js}')).toEqual(['a.js'])
  })
  it('rejects non-string input', () => {
    expect(() => expandBraces(42 as unknown as string)).toThrow(TypeError)
  })
  it('each expansion is round-trippable through matchesGlob (smoke)', () => {
    const expansions = expandBraces('src/{lib,bin}/*.ts')
    // Confirm both top-level expansions are present.
    expect(expansions).toContain('src/lib/*.ts')
    expect(expansions).toContain('src/bin/*.ts')
    // And that they actually match a path under the right subtree.
    expect(matchesGlob('src/lib/*.ts', 'src/lib/index.ts')).toBe(true)
    expect(matchesGlob('src/bin/*.ts', 'src/bin/cli.ts')).toBe(true)
    expect(matchesGlob('src/lib/*.ts', 'src/bin/cli.ts')).toBe(false)
  })
})

describe('integration — compile-once, test many', () => {
  it('filters a list of paths against a pre-compiled matcher', () => {
    const m = compileGlob('**/*.ts', { dot: true })
    const paths = [
      'src/foo.ts',
      'src/bar.tsx',
      'src/.hidden.ts',
      'README.md',
      'lib/deep/x.ts',
    ]
    const matched = paths.filter(p => m.test(p))
    expect(matched).toEqual(['src/foo.ts', 'src/.hidden.ts', 'lib/deep/x.ts'])
  })
})
