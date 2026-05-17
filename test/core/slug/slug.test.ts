// test/core/slug/slug.test.ts
import { describe, it, expect } from 'vitest'
import {
  slugify,
  safeFilename,
  safeBranchName,
} from '../../../src/core/slug'

// Build control-byte sequences at runtime so the source file stays
// clean ASCII (literal NULs and ESCs are hard to edit in many tools).
const NUL = String.fromCharCode(0)
const BEL = String.fromCharCode(0x07)
const ESC = String.fromCharCode(0x1b)
const DEL = String.fromCharCode(0x7f)

describe('slugify', () => {
  describe('basic happy path', () => {
    it('lowercases and replaces spaces with dashes', () => {
      expect(slugify('Hello World')).toBe('hello-world')
    })

    it('returns empty string for empty input', () => {
      expect(slugify('')).toBe('')
    })

    it('returns empty string for whitespace-only input', () => {
      expect(slugify('   \t\n  ')).toBe('')
    })

    it('returns empty string for non-string input', () => {
      expect(slugify(undefined as unknown as string)).toBe('')
      expect(slugify(null as unknown as string)).toBe('')
    })

    it('is idempotent on already-slug input', () => {
      expect(slugify('already-a-slug')).toBe('already-a-slug')
      expect(slugify(slugify('Hello World'))).toBe('hello-world')
    })

    it('collapses multiple separators / whitespace into one', () => {
      expect(slugify('foo  bar   baz')).toBe('foo-bar-baz')
      expect(slugify('foo___bar')).toBe('foo-bar')
      expect(slugify('foo---bar')).toBe('foo-bar')
    })

    it('strips leading and trailing separators', () => {
      expect(slugify('---hello---')).toBe('hello')
      expect(slugify('   hello   ')).toBe('hello')
    })

    it('joins multi-line input with the separator', () => {
      expect(slugify('first line\nsecond line')).toBe('first-line-second-line')
    })

    it('replaces every flavour of punctuation with separator', () => {
      expect(slugify('a!b@c#d$e%f^g&h*i')).toBe('a-b-c-d-e-f-g-h-i')
    })
  })

  describe('unicode handling', () => {
    it('strips accents in strict (default) mode via NFKD', () => {
      expect(slugify('Café résumé')).toBe('cafe-resume')
      expect(slugify('naïve façade')).toBe('naive-facade')
      expect(slugify('Ångström')).toBe('angstrom')
    })

    it('strips CJK in strict mode (no ASCII equivalent)', () => {
      expect(slugify('Hello 世界')).toBe('hello')
    })

    it('strips emoji in strict mode', () => {
      expect(slugify('party 🎉 time')).toBe('party-time')
    })

    it('preserves accented Latin with unicode: true', () => {
      expect(slugify('Café résumé', { unicode: true })).toBe('café-résumé')
    })

    it('preserves CJK with unicode: true', () => {
      expect(slugify('Hello 世界', { unicode: true })).toBe('hello-世界')
    })

    it('preserves Cyrillic with unicode: true', () => {
      expect(slugify('Привет Мир', { unicode: true })).toBe('привет-мир')
    })

    it('strips emoji even with unicode: true (emoji are not L or N)', () => {
      expect(slugify('party 🎉 time', { unicode: true })).toBe('party-time')
    })

    it('keeps original case with unicode and lower: false', () => {
      expect(slugify('Café résumé', { unicode: true, lower: false })).toBe(
        'Café-résumé',
      )
    })
  })

  describe('separator option', () => {
    it('uses a custom separator', () => {
      expect(slugify('hello world', { separator: '_' })).toBe('hello_world')
      expect(slugify('hello world foo', { separator: '.' })).toBe(
        'hello.world.foo',
      )
    })

    it('rejects multi-char separators', () => {
      expect(() => slugify('a b', { separator: '--' })).toThrow(RangeError)
    })

    it('handles regex-special separators via escape', () => {
      // `+`, `.`, `*` are regex-special. Our internal regexes must
      // treat them as literals.
      expect(slugify('a b c', { separator: '+' })).toBe('a+b+c')
      expect(slugify('a b c', { separator: '.' })).toBe('a.b.c')
    })
  })

  describe('strict mode', () => {
    it('preserves dots when strict: false', () => {
      expect(slugify('a.b.c', { strict: false })).toBe('a.b.c')
      expect(slugify('v1.2.3', { strict: false })).toBe('v1.2.3')
    })

    it('still rejects shell-unsafe punctuation when strict: false', () => {
      expect(slugify('foo & bar', { strict: false })).toBe('foo-bar')
      expect(slugify('a|b', { strict: false })).toBe('a-b')
    })
  })

  describe('maxLength truncation', () => {
    it('truncates without trailing separator', () => {
      // "hello-world-foo" truncated to 8 → "hello-wo"; no trailing sep.
      expect(slugify('Hello World Foo', { maxLength: 8 })).toBe('hello-wo')
    })

    it('trims trailing separator after truncation', () => {
      // "hello-world" truncated to 6 → "hello-" → trimmed to "hello"
      expect(slugify('hello world', { maxLength: 6 })).toBe('hello')
    })

    it('returns shorter string when boundary trim shortens result', () => {
      const result = slugify('aa bb cc', { maxLength: 5 })
      expect(result.endsWith('-')).toBe(false)
      expect(result.length).toBeLessThanOrEqual(5)
    })

    it('returns input unchanged when below maxLength', () => {
      expect(slugify('short', { maxLength: 100 })).toBe('short')
    })

    it('returns empty string for maxLength: 0', () => {
      expect(slugify('hello', { maxLength: 0 })).toBe('')
    })

    it('rejects negative maxLength', () => {
      expect(() => slugify('x', { maxLength: -1 })).toThrow(RangeError)
    })

    it('honours Infinity (the default)', () => {
      const long = 'a'.repeat(1000)
      expect(slugify(long, { maxLength: Infinity }).length).toBe(1000)
    })
  })

  describe('edge cases', () => {
    it('handles a long all-punctuation string', () => {
      expect(slugify('!!!@@@###$$$')).toBe('')
    })

    it('handles digits-only', () => {
      expect(slugify('123 456')).toBe('123-456')
    })

    it('handles mixed case + numbers', () => {
      expect(slugify('Iter 35: Slugify v2')).toBe('iter-35-slugify-v2')
    })

    it('handles surrogate-pair input without splitting it', () => {
      // 𝓗 (U+1D4D7) is outside BMP. With strict mode it gets stripped.
      // With unicode: true it's a Unicode letter (L), so kept.
      expect(slugify('𝓗ello', { unicode: true })).toBe('𝓗ello')
    })
  })
})

describe('safeFilename', () => {
  describe('basic happy path', () => {
    it('preserves a simple filename', () => {
      expect(safeFilename('My Doc.txt')).toBe('My Doc.txt')
    })

    it('preserves unicode letters', () => {
      expect(safeFilename('café résumé.pdf')).toBe('café résumé.pdf')
    })

    it('returns empty string for empty input', () => {
      expect(safeFilename('')).toBe('')
    })
  })

  describe('forbidden character replacement', () => {
    it('replaces forward slash', () => {
      expect(safeFilename('a/b.txt')).toBe('a_b.txt')
    })

    it('replaces backslash', () => {
      expect(safeFilename('a\\b.txt')).toBe('a_b.txt')
    })

    it('replaces all forbidden Windows characters', () => {
      expect(safeFilename('a:b*c?d"e<f>g|h.txt')).toBe('a_b_c_d_e_f_g_h.txt')
    })

    it('replaces null bytes', () => {
      expect(safeFilename(`a${NUL}b.txt`)).toBe('a_b.txt')
    })

    it('replaces control characters (BEL, ESC)', () => {
      expect(safeFilename(`a${BEL}b${ESC}c.txt`)).toBe('a_b_c.txt')
    })

    it('replaces DEL (0x7F)', () => {
      expect(safeFilename(`a${DEL}b.txt`)).toBe('a_b.txt')
    })

    it('collapses runs of replacement characters', () => {
      expect(safeFilename('a///b.txt')).toBe('a_b.txt')
      expect(safeFilename('a/\\:?b.txt')).toBe('a_b.txt')
    })

    it('uses a custom replacement char', () => {
      expect(safeFilename('a/b.txt', { replacement: '-' })).toBe('a-b.txt')
    })

    it('rejects multi-char replacement', () => {
      expect(() => safeFilename('a/b', { replacement: '--' })).toThrow(
        RangeError,
      )
    })

    it('rejects forbidden char as replacement', () => {
      expect(() => safeFilename('a/b', { replacement: '*' })).toThrow(
        RangeError,
      )
      expect(() => safeFilename('a/b', { replacement: '/' })).toThrow(
        RangeError,
      )
    })
  })

  describe('extension preservation', () => {
    it('preserves the extension across forbidden chars in the stem', () => {
      expect(safeFilename('My/Doc.txt')).toBe('My_Doc.txt')
    })

    it('treats leading dot as part of stem (dotfile)', () => {
      // `.bashrc` has no real extension; we don't carve `.bashrc` into
      // stem='' + ext='.bashrc'.
      expect(safeFilename('.bashrc')).toBe('.bashrc')
    })

    it('still replaces forbidden chars with preserveExtension: false', () => {
      expect(safeFilename('a/b.txt', { preserveExtension: false })).toBe(
        'a_b.txt',
      )
    })

    it('uses only the LAST dot as extension boundary', () => {
      expect(safeFilename('archive.tar.gz')).toBe('archive.tar.gz')
    })
  })

  describe('Windows reserved names', () => {
    it('prefixes CON, NUL, etc.', () => {
      expect(safeFilename('CON.txt')).toBe('_CON.txt')
      expect(safeFilename('nul.log')).toBe('_nul.log')
      expect(safeFilename('com1')).toBe('_com1')
    })

    it('uses the custom replacement char as prefix', () => {
      expect(safeFilename('CON.txt', { replacement: '-' })).toBe('-CON.txt')
    })

    it('only prefixes exact matches, not substrings', () => {
      expect(safeFilename('console.log')).toBe('console.log')
      expect(safeFilename('nullable.ts')).toBe('nullable.ts')
    })
  })

  describe('trailing dots and spaces', () => {
    it('strips trailing dots/spaces from the stem', () => {
      expect(safeFilename('foo...txt')).toBe('foo.txt')
      expect(safeFilename('foo   .txt')).toBe('foo.txt')
    })
  })

  describe('maxLength truncation', () => {
    it('truncates while preserving extension', () => {
      const long = 'a'.repeat(300) + '.txt'
      const result = safeFilename(long)
      expect(result.length).toBeLessThanOrEqual(255)
      expect(result.endsWith('.txt')).toBe(true)
    })

    it('truncates to default 255 chars', () => {
      const long = 'a'.repeat(500)
      expect(safeFilename(long).length).toBeLessThanOrEqual(255)
    })

    it('uses a custom maxLength', () => {
      expect(safeFilename('hello world.txt', { maxLength: 10 })).toMatch(
        /\.txt$/,
      )
      expect(
        safeFilename('hello world.txt', { maxLength: 10 }).length,
      ).toBeLessThanOrEqual(10)
    })

    it('rejects maxLength below 1', () => {
      expect(() => safeFilename('x', { maxLength: 0 })).toThrow(RangeError)
    })
  })

  describe('edge cases', () => {
    it('collapses all-forbidden input to a single replacement char', () => {
      // Every byte is forbidden, but the collapse pass turns the run
      // into one `_`. Callers detect "nothing salvageable" by length.
      expect(safeFilename('////')).toBe('_')
      expect(safeFilename('////', { replacement: '-' })).toBe('-')
    })

    it('handles file with no extension', () => {
      expect(safeFilename('Makefile')).toBe('Makefile')
    })

    it('handles emoji in stem', () => {
      // Emoji are not in our forbidden set; they survive.
      expect(safeFilename('party🎉.txt')).toBe('party🎉.txt')
    })
  })
})

describe('safeBranchName', () => {
  describe('basic happy path', () => {
    it('replaces colon and spaces', () => {
      expect(safeBranchName('feat: my thing')).toBe('feat-my-thing')
    })

    it('returns empty string for empty input', () => {
      expect(safeBranchName('')).toBe('')
    })

    it('preserves a clean branch name', () => {
      expect(safeBranchName('feat/login-flow')).toBe('feat/login-flow')
    })

    it('preserves namespace separators (forward slash)', () => {
      expect(safeBranchName('hotfix/2026-05/critical')).toBe(
        'hotfix/2026-05/critical',
      )
    })
  })

  describe('git-forbidden characters', () => {
    it('replaces ~', () => {
      expect(safeBranchName('hotfix/x~y')).toBe('hotfix/x-y')
    })

    it('replaces ^', () => {
      expect(safeBranchName('topic^old')).toBe('topic-old')
    })

    it('replaces :', () => {
      expect(safeBranchName('refs:main')).toBe('refs-main')
    })

    it('replaces ? and *', () => {
      expect(safeBranchName('what?ever*x')).toBe('what-ever-x')
    })

    it('replaces [ and \\', () => {
      expect(safeBranchName('a[b\\c')).toBe('a-b-c')
    })

    it('replaces whitespace and control chars', () => {
      expect(safeBranchName('a b\tc\nd')).toBe('a-b-c-d')
      expect(safeBranchName(`a${ESC}b`)).toBe('a-b')
    })
  })

  describe('git ref rules', () => {
    it('rejects .. sequences', () => {
      expect(safeBranchName('foo..bar')).toBe('foo-bar')
      expect(safeBranchName('a....b')).toBe('a-b')
    })

    it('collapses // sequences', () => {
      expect(safeBranchName('foo//bar')).toBe('foo/bar')
    })

    it('strips leading slash', () => {
      expect(safeBranchName('/foo/bar')).toBe('foo/bar')
    })

    it('strips trailing slash', () => {
      expect(safeBranchName('foo/bar/')).toBe('foo/bar')
    })

    it('strips leading dot', () => {
      expect(safeBranchName('.hidden')).toBe('hidden')
    })

    it('strips leading dash', () => {
      expect(safeBranchName('--force-push')).toBe('force-push')
    })

    it('strips trailing dot', () => {
      expect(safeBranchName('foo.')).toBe('foo')
    })

    it('strips trailing .lock', () => {
      expect(safeBranchName('mybranch.lock')).toBe('mybranch')
      expect(safeBranchName('mybranch.LOCK')).toBe('mybranch')
    })

    it('strips repeated trailing .lock', () => {
      expect(safeBranchName('mybranch.lock.lock')).toBe('mybranch')
    })
  })

  describe('replacement option', () => {
    it('uses a custom replacement char', () => {
      expect(safeBranchName('foo bar', { replacement: '_' })).toBe('foo_bar')
    })

    it('rejects multi-char replacement', () => {
      expect(() => safeBranchName('a b', { replacement: '--' })).toThrow(
        RangeError,
      )
    })

    it('rejects unsafe replacement chars', () => {
      expect(() => safeBranchName('a b', { replacement: '~' })).toThrow(
        RangeError,
      )
      expect(() => safeBranchName('a b', { replacement: ':' })).toThrow(
        RangeError,
      )
    })
  })

  describe('maxLength truncation', () => {
    it('respects custom maxLength', () => {
      const result = safeBranchName('this is a fairly long branch name', {
        maxLength: 12,
      })
      expect(result.length).toBeLessThanOrEqual(12)
      expect(result.endsWith('-')).toBe(false)
    })

    it('truncates to default 200', () => {
      const long = 'a-'.repeat(200)
      expect(safeBranchName(long).length).toBeLessThanOrEqual(200)
    })

    it('rejects maxLength below 1', () => {
      expect(() => safeBranchName('x', { maxLength: 0 })).toThrow(RangeError)
    })
  })

  describe('edge cases', () => {
    it('returns empty when everything was forbidden / stripped', () => {
      expect(safeBranchName('....')).toBe('')
      expect(safeBranchName('~~~')).toBe('')
    })

    it('idempotent on already-safe input', () => {
      const clean = 'feat/2026-05-17/slug-helper'
      expect(safeBranchName(clean)).toBe(clean)
      expect(safeBranchName(safeBranchName('feat/x y'))).toBe('feat/x-y')
    })

    it('preserves unicode letters (git allows them)', () => {
      expect(safeBranchName('feature/café')).toBe('feature/café')
    })
  })
})
