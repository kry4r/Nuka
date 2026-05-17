// test/core/caseConvert/caseConvert.test.ts
import { describe, it, expect } from 'vitest'
import {
  toCamelCase,
  toPascalCase,
  toKebabCase,
  toSnakeCase,
  toConstantCase,
  toTitleCase,
  toLowerCase,
  detectCase,
  splitWords,
} from '../../../src/core/caseConvert'

// ─── splitWords ─────────────────────────────────────────────────────

describe('splitWords', () => {
  it('returns empty for empty input', () => {
    expect(splitWords('')).toEqual([])
  })

  it('returns empty for non-string input', () => {
    expect(splitWords(null as unknown as string)).toEqual([])
    expect(splitWords(undefined as unknown as string)).toEqual([])
  })

  it('handles a single lowercase word', () => {
    expect(splitWords('hello')).toEqual(['hello'])
  })

  it('handles a single uppercase word', () => {
    expect(splitWords('HELLO')).toEqual(['HELLO'])
  })

  it('splits camelCase', () => {
    expect(splitWords('helloWorld')).toEqual(['hello', 'World'])
  })

  it('splits PascalCase', () => {
    expect(splitWords('HelloWorld')).toEqual(['Hello', 'World'])
  })

  it('splits kebab-case', () => {
    expect(splitWords('hello-world')).toEqual(['hello', 'world'])
  })

  it('splits snake_case', () => {
    expect(splitWords('hello_world')).toEqual(['hello', 'world'])
  })

  it('splits SCREAMING_SNAKE', () => {
    expect(splitWords('HELLO_WORLD')).toEqual(['HELLO', 'WORLD'])
  })

  it('preserves acronyms by default (parseHTTPResponse)', () => {
    expect(splitWords('parseHTTPResponse')).toEqual([
      'parse',
      'HTTP',
      'Response',
    ])
  })

  it('preserves leading acronyms (HTTPServer)', () => {
    expect(splitWords('HTTPServer')).toEqual(['HTTP', 'Server'])
  })

  it('preserves trailing acronyms (parseURL)', () => {
    expect(splitWords('parseURL')).toEqual(['parse', 'URL'])
  })

  it('handles plural acronyms (parseURLs)', () => {
    expect(splitWords('parseURLs')).toEqual(['parse', 'URLs'])
  })

  it('with preserveAcronyms: false, splits every uppercase letter', () => {
    expect(splitWords('parseHTTPResponse', { preserveAcronyms: false })).toEqual(
      ['parse', 'H', 'T', 'T', 'P', 'Response'],
    )
  })

  it('treats digits as their own word', () => {
    expect(splitWords('version2API')).toEqual(['version', '2', 'API'])
  })

  it('separates letter/digit boundary in lowercase tokens', () => {
    expect(splitWords('foo2bar')).toEqual(['foo', '2', 'bar'])
  })

  it('handles mixed separators', () => {
    expect(splitWords('hello world-foo_bar')).toEqual([
      'hello',
      'world',
      'foo',
      'bar',
    ])
  })

  it('trims surrounding whitespace', () => {
    expect(splitWords('  hello   world  ')).toEqual(['hello', 'world'])
  })

  it('handles path-like separators', () => {
    expect(splitWords('foo/bar.baz')).toEqual(['foo', 'bar', 'baz'])
  })

  it('handles backslash separators', () => {
    expect(splitWords('foo\\bar')).toEqual(['foo', 'bar'])
  })

  it('treats unicode letters as letters', () => {
    expect(splitWords('héllo_wörld')).toEqual(['héllo', 'wörld'])
  })

  it('returns empty for pure punctuation', () => {
    expect(splitWords('---___')).toEqual([])
  })
})

// ─── toCamelCase ────────────────────────────────────────────────────

describe('toCamelCase', () => {
  it('empty string', () => {
    expect(toCamelCase('')).toBe('')
  })

  it('single word', () => {
    expect(toCamelCase('hello')).toBe('hello')
  })

  it('from spaces', () => {
    expect(toCamelCase('hello world')).toBe('helloWorld')
  })

  it('from kebab', () => {
    expect(toCamelCase('hello-world')).toBe('helloWorld')
  })

  it('from snake', () => {
    expect(toCamelCase('hello_world')).toBe('helloWorld')
  })

  it('from constant', () => {
    expect(toCamelCase('HELLO_WORLD')).toBe('helloWorld')
  })

  it('from pascal', () => {
    expect(toCamelCase('HelloWorld')).toBe('helloWorld')
  })

  it('from acronym-bearing camel — acronyms get lowercased', () => {
    // Documented: we don't preserve acronyms on re-emit since the second
    // word becomes capitalize-first-only.
    expect(toCamelCase('parseHTTPResponse')).toBe('parseHttpResponse')
  })

  it('with numbers', () => {
    expect(toCamelCase('version2-api')).toBe('version2Api')
  })

  it('returns empty for pure punctuation', () => {
    expect(toCamelCase('---')).toBe('')
  })
})

// ─── toPascalCase ───────────────────────────────────────────────────

describe('toPascalCase', () => {
  it('empty string', () => {
    expect(toPascalCase('')).toBe('')
  })

  it('single word', () => {
    expect(toPascalCase('hello')).toBe('Hello')
  })

  it('from spaces', () => {
    expect(toPascalCase('hello world')).toBe('HelloWorld')
  })

  it('from kebab', () => {
    expect(toPascalCase('hello-world')).toBe('HelloWorld')
  })

  it('from snake', () => {
    expect(toPascalCase('hello_world')).toBe('HelloWorld')
  })

  it('from camel', () => {
    expect(toPascalCase('helloWorld')).toBe('HelloWorld')
  })

  it('from acronym-bearing camel — acronyms get lowercased', () => {
    expect(toPascalCase('parseHTTPResponse')).toBe('ParseHttpResponse')
  })
})

// ─── toKebabCase ────────────────────────────────────────────────────

describe('toKebabCase', () => {
  it('empty string', () => {
    expect(toKebabCase('')).toBe('')
  })

  it('single word', () => {
    expect(toKebabCase('hello')).toBe('hello')
    expect(toKebabCase('Hello')).toBe('hello')
    expect(toKebabCase('HELLO')).toBe('hello')
  })

  it('from camel', () => {
    expect(toKebabCase('helloWorld')).toBe('hello-world')
  })

  it('from pascal', () => {
    expect(toKebabCase('HelloWorld')).toBe('hello-world')
  })

  it('from snake', () => {
    expect(toKebabCase('hello_world')).toBe('hello-world')
  })

  it('from constant', () => {
    expect(toKebabCase('HELLO_WORLD')).toBe('hello-world')
  })

  it('preserves acronym → split (parseHTTPResponse)', () => {
    expect(toKebabCase('parseHTTPResponse')).toBe('parse-http-response')
  })

  it('with numbers', () => {
    expect(toKebabCase('version2API')).toBe('version-2-api')
  })

  it('is idempotent', () => {
    const k = 'parse-http-response-2'
    expect(toKebabCase(toKebabCase(k))).toBe(toKebabCase(k))
    expect(toKebabCase(k)).toBe(k)
  })

  it('idempotent on a variety of inputs', () => {
    for (const x of [
      '',
      'hello',
      'helloWorld',
      'HELLO_WORLD',
      'parseHTTPResponse',
      'version2API',
      'foo bar baz',
      'foo  bar---baz',
      'a-b-c',
    ]) {
      const once = toKebabCase(x)
      expect(toKebabCase(once)).toBe(once)
    }
  })
})

// ─── toSnakeCase ────────────────────────────────────────────────────

describe('toSnakeCase', () => {
  it('empty string', () => {
    expect(toSnakeCase('')).toBe('')
  })

  it('from camel', () => {
    expect(toSnakeCase('helloWorld')).toBe('hello_world')
  })

  it('from kebab', () => {
    expect(toSnakeCase('hello-world')).toBe('hello_world')
  })

  it('from constant', () => {
    expect(toSnakeCase('HELLO_WORLD')).toBe('hello_world')
  })

  it('preserves acronym → split', () => {
    expect(toSnakeCase('parseHTTPResponse')).toBe('parse_http_response')
  })

  it('with numbers', () => {
    expect(toSnakeCase('version2API')).toBe('version_2_api')
  })

  it('is idempotent', () => {
    expect(toSnakeCase('hello_world')).toBe('hello_world')
    expect(toSnakeCase(toSnakeCase('parseHTTPResponse'))).toBe(
      toSnakeCase('parseHTTPResponse'),
    )
  })
})

// ─── toConstantCase ─────────────────────────────────────────────────

describe('toConstantCase', () => {
  it('empty string', () => {
    expect(toConstantCase('')).toBe('')
  })

  it('single word', () => {
    expect(toConstantCase('hello')).toBe('HELLO')
  })

  it('from camel', () => {
    expect(toConstantCase('helloWorld')).toBe('HELLO_WORLD')
  })

  it('from kebab', () => {
    expect(toConstantCase('hello-world')).toBe('HELLO_WORLD')
  })

  it('preserves acronym → split (uppercased anyway)', () => {
    expect(toConstantCase('parseHTTPResponse')).toBe('PARSE_HTTP_RESPONSE')
  })

  it('with numbers', () => {
    expect(toConstantCase('version2API')).toBe('VERSION_2_API')
  })
})

// ─── toTitleCase ────────────────────────────────────────────────────

describe('toTitleCase', () => {
  it('empty string', () => {
    expect(toTitleCase('')).toBe('')
  })

  it('single word', () => {
    expect(toTitleCase('hello')).toBe('Hello')
  })

  it('from camel', () => {
    expect(toTitleCase('helloWorld')).toBe('Hello World')
  })

  it('from kebab', () => {
    expect(toTitleCase('hello-world')).toBe('Hello World')
  })

  it('from constant', () => {
    expect(toTitleCase('HELLO_WORLD')).toBe('Hello World')
  })

  it('from spaces', () => {
    expect(toTitleCase('hello world')).toBe('Hello World')
  })
})

// ─── toLowerCase ────────────────────────────────────────────────────

describe('toLowerCase (word-aware)', () => {
  it('empty string', () => {
    expect(toLowerCase('')).toBe('')
  })

  it('from camel', () => {
    expect(toLowerCase('helloWorld')).toBe('hello world')
  })

  it('from pascal', () => {
    expect(toLowerCase('HelloWorld')).toBe('hello world')
  })

  it('from constant', () => {
    expect(toLowerCase('HELLO_WORLD')).toBe('hello world')
  })

  it('passes through lower input', () => {
    expect(toLowerCase('hello world')).toBe('hello world')
  })
})

// ─── detectCase ─────────────────────────────────────────────────────

describe('detectCase', () => {
  it('empty → unknown', () => {
    expect(detectCase('')).toBe('unknown')
  })

  it('digits-only → unknown', () => {
    expect(detectCase('12345')).toBe('unknown')
  })

  it('camel', () => {
    expect(detectCase('helloWorld')).toBe('camel')
    expect(detectCase('parseHTTPResponse')).toBe('camel')
    // Note: 'a1b2' has no uppercase letter, so even though a programmer
    // might call it camelCase-shaped, we classify by case signal —
    // single-token-no-caps → 'lower'.
    expect(detectCase('a1b2')).toBe('lower')
  })

  it('pascal', () => {
    expect(detectCase('HelloWorld')).toBe('pascal')
    expect(detectCase('Hello')).toBe('pascal')
  })

  it('kebab', () => {
    expect(detectCase('hello-world')).toBe('kebab')
    expect(detectCase('hello-world-foo')).toBe('kebab')
  })

  it('snake', () => {
    expect(detectCase('hello_world')).toBe('snake')
    expect(detectCase('foo_bar_baz_2')).toBe('snake')
  })

  it('constant', () => {
    expect(detectCase('HELLO_WORLD')).toBe('constant')
    expect(detectCase('HELLO')).toBe('constant')
    expect(detectCase('FOO_BAR_2')).toBe('constant')
  })

  it('title', () => {
    expect(detectCase('Hello World')).toBe('title')
    expect(detectCase('The Quick Brown')).toBe('title')
  })

  it('lower (multi-word with spaces)', () => {
    expect(detectCase('hello world')).toBe('lower')
    expect(detectCase('hello')).toBe('lower')
  })

  it('mixed — separator + camel', () => {
    expect(detectCase('helloWorld-foo')).toBe('mixed')
  })

  it('mixed — snake with caps mid-word', () => {
    expect(detectCase('helloWorld_foo')).toBe('mixed')
  })

  it('mixed — title with extra caps', () => {
    expect(detectCase('Hello WORLD')).toBe('mixed')
  })
})

// ─── Cross-style round trip & idempotence ──────────────────────────

describe('round-trip & idempotence', () => {
  const inputs = [
    'hello',
    'helloWorld',
    'HelloWorld',
    'hello-world',
    'hello_world',
    'HELLO_WORLD',
    'parseHTTPResponse',
    'version2API',
    'foo bar baz',
    'mixed-form_input',
  ]

  for (const input of inputs) {
    it(`toKebab idempotent on ${JSON.stringify(input)}`, () => {
      const once = toKebabCase(input)
      expect(toKebabCase(once)).toBe(once)
    })

    it(`toSnake idempotent on ${JSON.stringify(input)}`, () => {
      const once = toSnakeCase(input)
      expect(toSnakeCase(once)).toBe(once)
    })

    it(`toCamel idempotent on ${JSON.stringify(input)}`, () => {
      const once = toCamelCase(input)
      expect(toCamelCase(once)).toBe(once)
    })
  }

  it('splitWords on a kebab matches splitWords on original (case-insensitive equality of word count)', () => {
    const original = 'parseHTTPResponse'
    const viaKebab = toKebabCase(original)
    expect(splitWords(viaKebab)).toEqual(['parse', 'http', 'response'])
    expect(splitWords(original)).toEqual(['parse', 'HTTP', 'Response'])
  })
})

// ─── Unicode behavior ───────────────────────────────────────────────

describe('Unicode', () => {
  it('preserves accented Latin letters in splitWords', () => {
    expect(splitWords('héllo_wörld')).toEqual(['héllo', 'wörld'])
  })

  it('toKebabCase on accented Latin', () => {
    expect(toKebabCase('héllo_wörld')).toBe('héllo-wörld')
  })

  it('toCamelCase on accented Latin', () => {
    expect(toCamelCase('héllo_wörld')).toBe('hélloWörld')
  })

  it('respects locale option (Turkish dotted I)', () => {
    // In Turkish, lowercase of 'I' is 'ı' (dotless i), not 'i'.
    expect(toLowerCase('HELLO', { locale: 'tr' })).toBe('hello')
    // The 'I' in 'BIG' lowercases to 'ı' under Turkish locale.
    // (Note: 'B' and 'G' are unaffected.)
    expect(toLowerCase('BIG', { locale: 'tr' })).toBe('bıg')
  })
})

// ─── Edge cases ─────────────────────────────────────────────────────

describe('edge cases', () => {
  it('all converters return empty string for empty input', () => {
    expect(toCamelCase('')).toBe('')
    expect(toPascalCase('')).toBe('')
    expect(toKebabCase('')).toBe('')
    expect(toSnakeCase('')).toBe('')
    expect(toConstantCase('')).toBe('')
    expect(toTitleCase('')).toBe('')
    expect(toLowerCase('')).toBe('')
  })

  it('all converters return empty for pure punctuation', () => {
    expect(toCamelCase('---')).toBe('')
    expect(toPascalCase('___')).toBe('')
    expect(toKebabCase(' . . . ')).toBe('')
    expect(toSnakeCase('//')).toBe('')
  })

  it('single-word inputs across all forms', () => {
    expect(toCamelCase('hello')).toBe('hello')
    expect(toPascalCase('hello')).toBe('Hello')
    expect(toKebabCase('hello')).toBe('hello')
    expect(toSnakeCase('hello')).toBe('hello')
    expect(toConstantCase('hello')).toBe('HELLO')
    expect(toTitleCase('hello')).toBe('Hello')
  })

  it('handles consecutive separators', () => {
    expect(toKebabCase('foo--bar__baz')).toBe('foo-bar-baz')
    expect(toCamelCase('foo--bar__baz')).toBe('fooBarBaz')
  })

  it('handles trailing separator', () => {
    expect(toKebabCase('foo-')).toBe('foo')
    expect(toKebabCase('-foo')).toBe('foo')
  })

  it('numeric-only segments are kept', () => {
    expect(toKebabCase('foo2bar')).toBe('foo-2-bar')
    expect(toCamelCase('foo2bar')).toBe('foo2Bar')
  })

  it('emoji is not a separator — preserved in the surrounding word', () => {
    // Emoji is neither a letter, digit, nor in our explicit separator
    // class (space / dash / underscore / dot / slash / backslash), so
    // it passes through as part of the surrounding word. Documented
    // behavior; callers needing emoji boundaries can preprocess.
    expect(splitWords('foo🚀bar')).toEqual(['foo🚀bar'])
  })
})
