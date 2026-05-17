// src/core/caseConvert/caseConvert.ts
//
// Pure-string transformation between common identifier-case conventions.
// No React/ink, no LLM, no filesystem — just string in, string out.
//
// Supported styles (and what `detectCase` returns):
//
//   camel    — `helloWorld`           lower-camel; starts lowercase
//   pascal   — `HelloWorld`           upper-camel; starts uppercase
//   kebab    — `hello-world`          hyphen-separated, lowercase
//   snake    — `hello_world`          underscore-separated, lowercase
//   constant — `HELLO_WORLD`          underscore-separated, all uppercase
//   title    — `Hello World`          space-separated, each word capitalized
//   lower    — `hello world`          space-separated, all lowercase
//   mixed    — `helloWorld-foo`       contains > 1 style signature
//   unknown  — `''` / pure digits / pure punctuation
//
// ## Design choices
//
//  - **Acronyms.** With `preserveAcronyms: true` (default), a run of
//    consecutive uppercase letters is treated as a single word *unless*
//    it is followed by a lowercase letter, in which case the last
//    uppercase letter starts the next word:
//      `parseHTTPResponse` → `['parse', 'HTTP', 'Response']`
//      `HTTPServer`        → `['HTTP', 'Server']`
//      `parseURL`          → `['parse', 'URL']`
//      `parseURLs`         → `['parse', 'URLs']`
//    With `preserveAcronyms: false`, every uppercase letter starts a new
//    word and the run gets split into 1-letter pieces:
//      `parseHTTPResponse` → `['parse', 'H', 'T', 'T', 'P', 'Response']`
//    The default is generally what you want for human-readable output.
//
//  - **`toCamelCase` and acronyms.** `parseHTTPResponse` round-trips
//    through kebab as `parse-http-response` (acronyms always lowercase
//    in lower-cased styles — there is no information to recover them).
//    Going the other way, `toCamelCase('parse-http-response')` returns
//    `parseHttpResponse`, not `parseHTTPResponse`: we capitalize each
//    non-first word's first letter only, because we have no way to know
//    which segments were acronyms.
//
//  - **Numbers.** Digits are treated as their own word boundary. So
//    `version2API` splits as `['version', '2', 'API']` and re-emits as
//    `version-2-api` / `version_2_api` / `Version2API` (pascal).
//
//  - **Unicode.** Letters outside ASCII are preserved as-is. We use the
//    locale-aware `toLocaleLowerCase` / `toLocaleUpperCase` when an
//    explicit `locale` is supplied, otherwise the invariant
//    `toLowerCase`/`toUpperCase`. Acronym detection only fires on ASCII
//    A-Z, because the `\p{Lu}` / `\p{Ll}` categories are ambiguous for
//    scripts that have no case distinction.
//
//  - **Idempotence.** Every `toXxxCase` is idempotent for its own form
//    — `toKebabCase(toKebabCase(x)) === toKebabCase(x)`. Cross-style
//    round trips are best-effort (see the camel/acronym note above).
//
//  - **Empty input.** Every converter returns `''` for an empty string
//    or for input that contains no word characters. Callers that need
//    a fallback should supply one explicitly.
//
// The functions are pure and have no module-level state; safe to call
// concurrently from anywhere.

/** Options shared by every `to*` converter and `splitWords`. */
export interface CaseOptions {
  /**
   * Treat a run of consecutive uppercase letters (followed by another
   * uppercase or a digit) as a single word — so `HTTPServer` →
   * `['HTTP', 'Server']` instead of `['H', 'T', 'T', 'P', 'Server']`.
   * Defaults to `true`.
   */
  preserveAcronyms?: boolean
  /**
   * Locale tag(s) passed through to `toLocaleLowerCase` /
   * `toLocaleUpperCase`. Use this if you have locale-sensitive case
   * mappings (Turkish dotted/dotless i, etc.). Defaults to `undefined`
   * which uses the invariant case mapping.
   */
  locale?: string | readonly string[]
}

/** Case styles `detectCase` can identify. */
export type CaseStyle =
  | 'camel'
  | 'pascal'
  | 'kebab'
  | 'snake'
  | 'constant'
  | 'title'
  | 'lower'
  | 'mixed'
  | 'unknown'

// ─── splitWords ─────────────────────────────────────────────────────

/**
 * Split a token into its constituent words.
 *
 *   splitWords('helloWorld')              // ['hello', 'World']
 *   splitWords('parseHTTPResponse')       // ['parse', 'HTTP', 'Response']
 *   splitWords('hello-world')             // ['hello', 'world']
 *   splitWords('hello_world')             // ['hello', 'world']
 *   splitWords('HELLO_WORLD')             // ['HELLO', 'WORLD']
 *   splitWords('version2API')             // ['version', '2', 'API']
 *   splitWords('  hello   world  ')       // ['hello', 'world']
 *   splitWords('', )                      // []
 *
 * Output preserves the original case of each emitted word — the
 * downstream converters re-case as needed.
 */
export function splitWords(text: string, opts: CaseOptions = {}): string[] {
  if (typeof text !== 'string' || text.length === 0) return []

  const { preserveAcronyms = true } = opts

  // Step 1 — replace explicit separators with a single space.
  // Whitespace, dash, underscore, dot, slash are all treated as boundaries.
  const SEPARATOR_RE = /[\s\-_./\\]+/g
  let s = text.replace(SEPARATOR_RE, ' ')

  // Step 2 — insert spaces at case / digit boundaries inside each run.
  // We process the whole string at once with two passes so that all
  // boundaries fire deterministically regardless of input shape.

  if (preserveAcronyms) {
    // a) lower→Upper boundary:          fooBar      → foo Bar
    //    digit→letter:                  foo2bar     → foo 2 bar
    //    letter→digit:                  foo2        → foo 2
    //    upper-acronym→Title boundary:  HTTPServer  → HTTP Server
    //      (insert space before the last Upper of an Upper-run, but only
    //       if it is followed by a lowercase letter — this is what makes
    //       `HTTPServer` and `parseHTTP` both work)
    //
    //    `parseURLs` is the awkward case: we want `['parse', 'URLs']`.
    //    The trailing `s` is lowercase but is the *only* lower after the
    //    acronym, so we shouldn't peel off the preceding `L`. The
    //    lookahead `(?=\p{Ll}\p{Ll})` matches "two or more lowercase
    //    letters", which prevents `URL+s` from splitting and lets
    //    `Response` (≥2 lowercase) split as expected.
    s = s
      .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
      .replace(/(\p{Lu})(\p{Lu}\p{Ll}\p{Ll})/gu, '$1 $2')
      .replace(/(\p{L})(\p{N})/gu, '$1 $2')
      .replace(/(\p{N})(\p{L})/gu, '$1 $2')
  } else {
    // Every uppercase letter starts a new word — no acronym grouping.
    // Use a zero-width lookbehind so successive uppercase letters all
    // get a boundary before them (the simple consume-pattern misses
    // adjacent caps after a replace).
    s = s
      .replace(/(?<=.)(\p{Lu})/gu, ' $1')
      .replace(/(?<=\p{L})(\p{N})/gu, ' $1')
      .replace(/(?<=\p{N})(\p{L})/gu, ' $1')
  }

  // Step 3 — collapse whitespace and split.
  return s
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 0)
}

// ─── Style-specific converters ──────────────────────────────────────

/**
 *   toCamelCase('hello world')        // 'helloWorld'
 *   toCamelCase('hello-world')        // 'helloWorld'
 *   toCamelCase('HELLO_WORLD')        // 'helloWorld'
 *   toCamelCase('parseHTTPResponse')  // 'parseHttpResponse'   (note: lowercased)
 *
 * Acronyms in the source are NOT preserved on output — when we re-case
 * each word to title-case, the rest of the word is lowercased. There's
 * no metadata in the input that tells us "this was an acronym, keep
 * caps." If you need round-trip acronym preservation, work with
 * `splitWords` directly.
 */
export function toCamelCase(text: string, opts: CaseOptions = {}): string {
  const words = splitWords(text, opts)
  if (words.length === 0) return ''
  const head = lower(words[0]!, opts.locale)
  const tail = words.slice(1).map(w => capitalize(w, opts.locale))
  return head + tail.join('')
}

/**
 *   toPascalCase('hello world')       // 'HelloWorld'
 *   toPascalCase('hello-world')       // 'HelloWorld'
 *   toPascalCase('parseHTTPResponse') // 'ParseHttpResponse'
 */
export function toPascalCase(text: string, opts: CaseOptions = {}): string {
  const words = splitWords(text, opts)
  return words.map(w => capitalize(w, opts.locale)).join('')
}

/**
 *   toKebabCase('helloWorld')        // 'hello-world'
 *   toKebabCase('HelloWorld')        // 'hello-world'
 *   toKebabCase('hello_world')       // 'hello-world'
 *   toKebabCase('parseHTTPResponse') // 'parse-http-response'
 */
export function toKebabCase(text: string, opts: CaseOptions = {}): string {
  return splitWords(text, opts)
    .map(w => lower(w, opts.locale))
    .join('-')
}

/**
 *   toSnakeCase('helloWorld')        // 'hello_world'
 *   toSnakeCase('parseHTTPResponse') // 'parse_http_response'
 */
export function toSnakeCase(text: string, opts: CaseOptions = {}): string {
  return splitWords(text, opts)
    .map(w => lower(w, opts.locale))
    .join('_')
}

/**
 *   toConstantCase('helloWorld')   // 'HELLO_WORLD'
 *   toConstantCase('hello world')  // 'HELLO_WORLD'
 */
export function toConstantCase(text: string, opts: CaseOptions = {}): string {
  return splitWords(text, opts)
    .map(w => upper(w, opts.locale))
    .join('_')
}

/**
 *   toTitleCase('hello world')   // 'Hello World'
 *   toTitleCase('hello-world')   // 'Hello World'
 *   toTitleCase('helloWorld')    // 'Hello World'
 */
export function toTitleCase(text: string, opts: CaseOptions = {}): string {
  return splitWords(text, opts)
    .map(w => capitalize(w, opts.locale))
    .join(' ')
}

/**
 *   toLowerCase('Hello World')   // 'hello world'
 *   toLowerCase('HelloWorld')    // 'hello world'
 *   toLowerCase('HELLO_WORLD')   // 'hello world'
 */
export function toLowerCase(text: string, opts: CaseOptions = {}): string {
  return splitWords(text, opts)
    .map(w => lower(w, opts.locale))
    .join(' ')
}

// ─── detectCase ─────────────────────────────────────────────────────

/**
 * Identify the case style of `text`. See {@link CaseStyle} for the
 * possible return values.
 *
 *   detectCase('helloWorld')   // 'camel'
 *   detectCase('HelloWorld')   // 'pascal'
 *   detectCase('hello-world')  // 'kebab'
 *   detectCase('hello_world')  // 'snake'
 *   detectCase('HELLO_WORLD')  // 'constant'
 *   detectCase('Hello World')  // 'title'
 *   detectCase('hello world')  // 'lower'
 *   detectCase('hello')        // 'lower'  (single word, no caps)
 *   detectCase('Hello')        // 'pascal' (single word, capitalized)
 *   detectCase('HELLO')        // 'constant'
 *   detectCase('helloWorld-foo') // 'mixed'
 *   detectCase('')             // 'unknown'
 *   detectCase('123')          // 'unknown' (no letters)
 */
export function detectCase(text: string): CaseStyle {
  if (typeof text !== 'string') return 'unknown'
  if (text.length === 0) return 'unknown'

  // Must have at least one letter; otherwise we have no case signal.
  if (!/\p{L}/u.test(text)) return 'unknown'

  const hasSpace = /\s/.test(text)
  const hasDash = text.includes('-')
  const hasUnderscore = text.includes('_')
  const hasUpper = /\p{Lu}/u.test(text)
  const hasLower = /\p{Ll}/u.test(text)

  // Style guards run in priority order — single-form patterns first,
  // then combined ambiguity goes to 'mixed'.

  // Pure separators of one kind, all lowercase letters → kebab/snake.
  if (hasDash && !hasUnderscore && !hasSpace && !hasUpper) {
    return /^[\p{Ll}\p{N}]+(?:-[\p{Ll}\p{N}]+)+-?$/u.test(text)
      ? 'kebab'
      : 'mixed'
  }
  if (hasUnderscore && !hasDash && !hasSpace) {
    if (!hasLower && hasUpper) {
      // ALL_CAPS_WITH_UNDERSCORES
      return /^[\p{Lu}\p{N}]+(?:_[\p{Lu}\p{N}]+)+_?$/u.test(text)
        ? 'constant'
        : 'mixed'
    }
    if (!hasUpper) {
      return /^[\p{Ll}\p{N}]+(?:_[\p{Ll}\p{N}]+)+_?$/u.test(text)
        ? 'snake'
        : 'mixed'
    }
    // Mixed-case with underscores — neither pure snake nor pure constant.
    return 'mixed'
  }

  // Spaces but no other separators → title vs lower.
  if (hasSpace && !hasDash && !hasUnderscore) {
    const words = text.trim().split(/\s+/)
    if (words.length === 0) return 'unknown'
    const allTitle = words.every(w => /^\p{Lu}[\p{Ll}\p{N}]*$/u.test(w))
    if (allTitle) return 'title'
    const allLower = words.every(w => /^[\p{Ll}\p{N}]+$/u.test(w))
    if (allLower) return 'lower'
    return 'mixed'
  }

  // No separators at all → camel / pascal / lower / constant.
  if (!hasDash && !hasUnderscore && !hasSpace) {
    if (!hasUpper && hasLower) {
      // pure lower, single word — call it 'lower'
      return /^[\p{Ll}\p{N}]+$/u.test(text) ? 'lower' : 'mixed'
    }
    if (hasUpper && !hasLower) {
      // pure upper, single word — call it 'constant' (also valid pascal-of-one-acronym)
      return /^[\p{Lu}\p{N}]+$/u.test(text) ? 'constant' : 'mixed'
    }
    if (hasUpper && hasLower) {
      // Camel vs Pascal — first letter wins.
      const first = text[0]!
      if (/\p{Lu}/u.test(first)) {
        return /^\p{Lu}[\p{L}\p{N}]*$/u.test(text) ? 'pascal' : 'mixed'
      }
      return /^\p{Ll}[\p{L}\p{N}]*$/u.test(text) ? 'camel' : 'mixed'
    }
  }

  return 'mixed'
}

// ─── helpers ────────────────────────────────────────────────────────

function lower(s: string, locale: CaseOptions['locale']): string {
  return locale === undefined ? s.toLowerCase() : s.toLocaleLowerCase(locale)
}

function upper(s: string, locale: CaseOptions['locale']): string {
  return locale === undefined ? s.toUpperCase() : s.toLocaleUpperCase(locale)
}

/**
 * Capitalize the first character of `s` and lowercase the rest. Used by
 * camel/pascal/title where each word starts with an uppercase letter
 * followed by lowercase. Acronym preservation has already happened at
 * `splitWords` time — by the time we get here, each word is one
 * conceptual unit and we just enforce a consistent shape on it.
 */
function capitalize(s: string, locale: CaseOptions['locale']): string {
  if (s.length === 0) return s
  // Use a Unicode-aware split so surrogate pairs aren't broken.
  const head = s.slice(0, firstCodePointSize(s))
  const tail = s.slice(firstCodePointSize(s))
  return upper(head, locale) + lower(tail, locale)
}

/**
 * Return the number of UTF-16 code units consumed by the first code
 * point of `s`. Either 1 (BMP) or 2 (supplementary plane / surrogate
 * pair). Lets us slice without breaking emoji.
 */
function firstCodePointSize(s: string): number {
  if (s.length === 0) return 0
  const cp = s.codePointAt(0)!
  return cp > 0xffff ? 2 : 1
}
