// src/core/glob/glob.ts
//
// Minimal, pure-logic glob matcher. Pattern compilation + matching only —
// no filesystem, no React/ink, no LLM. The intended consumers are file
// filters in already-listed inputs, pattern-based config, and tool
// argument validation: places where the caller already has a list of
// strings (paths or otherwise) in hand and just needs a fast yes/no
// predicate.
//
// Why a separate module? Two existing call sites in the repo already
// reach for picomatch directly (`core/tools/glob.ts` for the GlobTool
// scan, and `core/permission/cache.ts` for permission rule matching),
// and the gitignore filter at `core/fileSearch/gitignoreFilter.ts`
// hand-rolls a *gitignore-spec* subset. Neither is the right shape for
// general-purpose path-pattern checks: the tool form hides the regex
// behind an async file walk, and the gitignore form only models
// "include/exclude with `!` negation against basename or anchored
// path". This module fills the gap with a small, well-documented
// surface focused on:
//
//   - `compileGlob(pattern, opts)` → `{ test, source }` — compile once,
//     test many. The `source` field exposes the compiled regex source
//     so callers building debug/output can present it without re-
//     running the compile step.
//   - `matchesGlob(pattern, path, opts)` — convenience one-shot for the
//     common single-use case (compile + test + discard).
//   - `globToRegex(pattern, opts)` — escape hatch for power users who
//     want to compose the regex into a larger pattern (e.g. negative
//     lookaheads, joins).
//   - `expandBraces(pattern)` — split `a/{b,c}/d` into
//     `['a/b/d', 'a/c/d']`. Handy when callers need *all* literal
//     pattern strings (e.g. to seed a UI / show users what a brace
//     pattern expands to).
//
// Why picomatch? It's already a Nuka dependency (^4.0.4 — used by
// `core/tools/glob.ts` and `core/permission/cache.ts`). Re-using it
// gets us battle-tested handling of `*` / `**` / `?` / `[…]` /
// `{a,b,c}` / leading-`!` negation / escapes for free. The wrapper
// here adds three things picomatch alone doesn't quite give us:
//
//   1. A stable, narrow surface. Picomatch's PicomatchOptions has 30+
//      fields; we expose only the two we promise to keep (`dot`,
//      `caseInsensitive`). Future picomatch versions can rearrange
//      their option surface without breaking our callers.
//   2. Explicit handling for the leading-`/` "anchored-to-root" case
//      and the trailing-`/` "directory contents" case. Picomatch
//      doesn't strip a leading `/`, and trailing-`/` semantics in
//      glob-ish ecosystems are inconsistent. We define them explicitly
//      so the test expectations stay readable.
//   3. A safe contract for the empty-pattern / empty-path edge cases.
//      Calling `picomatch('')` throws TypeError; our wrapper returns a
//      well-defined predicate matching only the empty string.
//
// What we do NOT do: read the filesystem, expand `~`, normalise
// Windows backslashes, or follow symlinks. Callers normalise paths
// before passing them in (relative paths, forward slashes) — this
// matches how `core/tools/glob.ts` already pre-formats inputs.

import picomatch from 'picomatch'

/**
 * Options accepted by every public function in this module. Kept tiny
 * on purpose — the picomatch surface is huge, and we only commit to
 * the two flags consumers actually need.
 */
export interface GlobOptions {
  /**
   * When `true`, the pattern matches case-insensitively (`*.TXT`
   * matches `foo.txt`). Defaults to `false`, which preserves picomatch
   * defaults and lets `*.ts` not match `Foo.TS` on case-sensitive file
   * systems.
   */
  caseInsensitive?: boolean
  /**
   * When `true`, `*` and `?` are allowed to match path components that
   * start with `.`. By default (gitignore-like, picomatch-default),
   * `*` will NOT match `.hidden` — callers must opt in if they want
   * to glob dotfiles. The flag is forwarded as picomatch's `dot`
   * option verbatim.
   */
  dot?: boolean
}

/**
 * Compiled glob matcher. Returned by {@link compileGlob}. Use `test`
 * for the hot path; `source` is the underlying compiled regex's source
 * string, exposed for debug output, snapshot tests, or anyone that
 * wants to mix the matcher's pattern into a larger regex.
 *
 * The matcher is referentially stable: the same `compileGlob` call
 * (same `pattern` + same `opts`) returns a fresh instance, but the
 * `test` function is a closed-over callable that's cheap to retain.
 */
export interface GlobMatcher {
  /** Returns `true` iff `path` is matched by the compiled pattern. */
  test(path: string): boolean
  /**
   * Underlying compiled regex source string (e.g.
   * `^(?:(?!\.)(?=.)[^/]*?\.ts\/?)$`). Surfaced for logging and tests.
   * Callers that need the live `RegExp` instance should use
   * {@link globToRegex} instead — re-running the compile is cheap.
   */
  source: string
}

/**
 * Empty pattern is special — picomatch throws on it. We document a
 * predictable degenerate matcher: empty pattern matches only the
 * empty string, never anything else. This lets callers feed
 * user-typed input through the matcher without an outer try/catch.
 */
const EMPTY_MATCHER: GlobMatcher = {
  test(path: string): boolean {
    return path === ''
  },
  source: '(?:^$)',
}

/**
 * Pre-process the raw user pattern before handing it to picomatch.
 *
 *   - Leading `/` is stripped — picomatch already treats unanchored
 *     patterns as full-path matches against the input string (NOT a
 *     basename match by default), so once the leading `/` is gone the
 *     remaining pattern is effectively anchored to the root.
 *     Difference from gitignore: gitignore would do a basename match
 *     for unanchored patterns; *we* never do that. `foo` matches the
 *     path `foo` exactly, not `bar/foo`.
 *   - Trailing `/` is rewritten to `/**` — "match every path inside
 *     this directory". A user-typed `dist/` should match `dist/x` and
 *     `dist/x/y` and so on. (Picomatch's globstar will also accept
 *     bare `dist`; we don't fight that, since the semantic "this
 *     directory" still matches.)
 *   - Empty string is left empty and short-circuited by the caller
 *     (see {@link EMPTY_MATCHER}).
 *
 * No other normalisation. We do NOT convert backslashes — Windows
 * callers should pre-normalise to forward slashes; this matches the
 * existing convention in `core/tools/glob.ts`.
 */
function preprocess(pattern: string): string {
  if (pattern.length === 0) return ''
  // Pure `/` is a degenerate "anchor to root with no payload" — treat
  // as match-all. Handle BEFORE the leading-slash strip below would
  // collapse it to the empty string.
  if (pattern === '/') return '**'
  let out = pattern
  // Strip a single leading slash — explicit "root anchor". Picomatch's
  // matchers are already full-path matches, so the slash is redundant
  // once removed.
  if (out.startsWith('/')) out = out.slice(1)
  // Trailing slash → "all paths inside this directory".
  if (out.endsWith('/') && out.length > 1) out = `${out}**`
  return out
}

/**
 * Translate our public {@link GlobOptions} to the subset of picomatch's
 * `PicomatchOptions` we actually want to forward. We deliberately
 * don't pass-through anything else — picomatch defaults are fine.
 */
function toPicomatchOptions(
  opts: GlobOptions | undefined,
): { nocase?: boolean; dot?: boolean } {
  if (!opts) return {}
  const out: { nocase?: boolean; dot?: boolean } = {}
  if (opts.caseInsensitive) out.nocase = true
  if (opts.dot) out.dot = true
  return out
}

/**
 * Compile `pattern` into a reusable {@link GlobMatcher}.
 *
 * Use this when you'll test many paths against the same pattern (e.g.
 * filtering a directory listing, or hot-checking incoming tool inputs).
 * For a single-shot check, {@link matchesGlob} is shorter.
 *
 * Behaviour:
 *  - Empty pattern → matcher matches only the empty string. (Picomatch
 *    itself throws; we explicitly degrade.)
 *  - Leading `/` is stripped; trailing `/` becomes `/**` (see
 *    {@link preprocess}).
 *  - All other glob features (`*`, `**`, `?`, `[abc]`, `{a,b}`,
 *    leading `!` for negation, backslash escapes) are forwarded
 *    verbatim to picomatch.
 *
 * Throws `TypeError` if `pattern` is not a string. We propagate
 * picomatch's invalid-pattern errors for malformed brace / character-
 * class patterns instead of swallowing them — callers can wrap in a
 * try/catch if they accept untrusted patterns.
 */
export function compileGlob(
  pattern: string,
  opts?: GlobOptions,
): GlobMatcher {
  if (typeof pattern !== 'string') {
    throw new TypeError(`compileGlob: pattern must be a string, got ${typeof pattern}`)
  }
  if (pattern.length === 0) return EMPTY_MATCHER
  const processed = preprocess(pattern)
  // After preprocess `processed` is still a non-empty string (worst
  // case: `**`), so picomatch will not throw on the empty-string path.
  const isMatch = picomatch(processed, toPicomatchOptions(opts))
  const regex = picomatch.makeRe(processed, toPicomatchOptions(opts))
  return {
    test(path: string): boolean {
      if (typeof path !== 'string') return false
      return isMatch(path)
    },
    source: regex.source,
  }
}

/**
 * One-shot convenience: compile `pattern` and test it against `path`
 * immediately. Equivalent to `compileGlob(pattern, opts).test(path)`.
 *
 * Prefer {@link compileGlob} when matching multiple paths against the
 * same pattern — the compile step is the expensive bit, and reusing
 * the matcher saves the regex re-build.
 */
export function matchesGlob(
  pattern: string,
  path: string,
  opts?: GlobOptions,
): boolean {
  return compileGlob(pattern, opts).test(path)
}

/**
 * Compile `pattern` into a `RegExp`. Use this only if you need the
 * raw regex instance (e.g. to combine multiple patterns into a single
 * regex, or to reach for `RegExp.exec` to capture matched portions).
 *
 * The returned regex carries the same preprocessing rules as
 * {@link compileGlob} (leading `/` stripped, trailing `/` rewritten).
 *
 * Edge cases:
 *  - Empty pattern → returns `/^$/` so callers get a consistent
 *    "matches only empty" regex without a separate special case.
 */
export function globToRegex(pattern: string, opts?: GlobOptions): RegExp {
  if (typeof pattern !== 'string') {
    throw new TypeError(`globToRegex: pattern must be a string, got ${typeof pattern}`)
  }
  if (pattern.length === 0) return /^$/
  const processed = preprocess(pattern)
  return picomatch.makeRe(processed, toPicomatchOptions(opts))
}

/**
 * Expand a brace pattern into the list of literal patterns it covers.
 *
 *   - `a.{js,ts}`          → `['a.js', 'a.ts']`
 *   - `a/{b,c}/d`          → `['a/b/d', 'a/c/d']`
 *   - `a/{b,c}/{x,y}`      → `['a/b/x', 'a/b/y', 'a/c/x', 'a/c/y']`
 *   - `no.braces`          → `['no.braces']`
 *   - Nested: `{a,b{c,d}}` → `['a', 'bc', 'bd']`
 *
 * Behaviour notes:
 *  - This is a *syntactic* expansion only — it does NOT preserve the
 *    `*` / `**` / `?` characters specially; they ride along inside
 *    each alternative as ordinary characters from the expander's view.
 *    Callers that want match testing should pipe each result back
 *    through {@link compileGlob}.
 *  - Numeric ranges like `{1..5}` are NOT expanded (we don't pull in
 *    picomatch's `braces` helper). Callers needing range expansion
 *    should expand it themselves first.
 *  - A single brace group of length 1 (`a.{js}`) expands to one
 *    result with the brace stripped (`a.js`). Empty alternative
 *    (`{a,}`) is preserved as the empty alternative.
 *  - Unbalanced braces are emitted as literal characters (the input
 *    is returned as a single-element array).
 *
 * Implementation: a tiny recursive-descent expander. We walk the
 * pattern once, splitting top-level commas inside the outermost brace
 * group, and recursing on the rest. This keeps the algorithm O(n * m)
 * where m = total expansion size — sufficient for the size of
 * patterns a CLI sees in practice.
 */
export function expandBraces(pattern: string): string[] {
  if (typeof pattern !== 'string') {
    throw new TypeError(`expandBraces: pattern must be a string, got ${typeof pattern}`)
  }
  if (pattern.length === 0) return ['']
  // Quick reject: no brace, no work.
  if (!pattern.includes('{')) return [pattern]

  // Find the FIRST top-level `{` and its matching `}`. We rely on a
  // depth counter so nested braces are tracked correctly.
  let depth = 0
  let openIdx = -1
  let closeIdx = -1
  let escaped = false
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\') {
      escaped = true
      continue
    }
    if (ch === '{') {
      if (depth === 0) openIdx = i
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) {
        closeIdx = i
        break
      }
      if (depth < 0) {
        // Unbalanced: stray `}` before any `{`. Return as literal.
        return [pattern]
      }
    }
  }
  if (openIdx < 0 || closeIdx < 0) {
    // No matched pair found — treat the whole thing as literal.
    return [pattern]
  }

  const prefix = pattern.slice(0, openIdx)
  const middle = pattern.slice(openIdx + 1, closeIdx)
  const suffix = pattern.slice(closeIdx + 1)

  // Split the middle on TOP-LEVEL commas (commas at brace depth 0).
  const parts = splitTopLevelCommas(middle)
  if (parts.length === 0) {
    // Empty brace group `{}` → expand to a single empty alternative.
    return expandBraces(`${prefix}${suffix}`)
  }

  // Recurse: each alternative might itself contain braces.
  const results: string[] = []
  for (const part of parts) {
    // Each part is one alternative; combine with prefix + recursively
    // expanded suffix.
    const partExpansions = expandBraces(part)
    const suffixExpansions = expandBraces(suffix)
    for (const pe of partExpansions) {
      for (const se of suffixExpansions) {
        results.push(`${prefix}${pe}${se}`)
      }
    }
  }
  return results
}

/**
 * Helper for {@link expandBraces}: split a string on commas that are
 * NOT inside a nested brace group. Backslash-escaped commas are
 * preserved as literal commas.
 */
function splitTopLevelCommas(input: string): string[] {
  const out: string[] = []
  let depth = 0
  let escaped = false
  let buf = ''
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (escaped) {
      buf += ch
      escaped = false
      continue
    }
    if (ch === '\\') {
      buf += ch
      escaped = true
      continue
    }
    if (ch === '{') {
      depth++
      buf += ch
      continue
    }
    if (ch === '}') {
      depth--
      buf += ch
      continue
    }
    if (ch === ',' && depth === 0) {
      out.push(buf)
      buf = ''
      continue
    }
    buf += ch
  }
  out.push(buf)
  return out
}
