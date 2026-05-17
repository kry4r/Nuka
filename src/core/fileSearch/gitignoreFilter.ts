// src/core/fileSearch/gitignoreFilter.ts
//
// Hand-rolled .gitignore-style pattern filter for the file walker.
//
// Why hand-rolled? Upstream (Nuka-Code) uses the `ignore` npm package
// (see `src/hooks/fileSuggestions.ts:loadRipgrepIgnorePatterns`), but
// Nuka deliberately keeps fileSearch dependency-free (see header on
// `walker.ts`). The semantics we need are a small subset of full
// gitignore — enough for the path-palette / fuzzy-search use case.
//
// What we support (from the gitignore spec):
//   - blank lines and `#…` comments are skipped;
//   - lines beginning with `!` are negations (re-include);
//   - trailing `/` makes the pattern dir-only (matches a directory
//     entry, plus everything underneath);
//   - leading `/` (or any embedded `/`) anchors the pattern to the
//     repo root; otherwise the pattern matches at ANY depth (basename
//     match);
//   - `*` matches any run of chars within a path segment (no `/`);
//   - `**` between slashes (i.e. `/**/`, `**/`, `/**`) matches zero
//     or more whole path segments;
//   - `?` matches a single non-slash char;
//   - backslash escapes (`\!foo`, `\#foo`) — minimal handling: we
//     strip the leading `\` so the next char is treated literally.
//
// What we DON'T support (intentionally):
//   - per-directory nested `.gitignore` files. Only the patterns from
//     `repoRoot/.gitignore` (+ `.ignore`, `.rgignore`) are loaded.
//     For most app-level use, the root `.gitignore` covers it; if
//     you need true nested resolution, shell out to `git check-ignore`
//     instead (see `git.ts` in upstream).
//   - character classes `[abc]` (gitignore allows them; we don't).
//
// The predicate returned by `createGitignoreFilter` matches the
// `shouldInclude: (relPath) => boolean` shape `walker.ts` expects.
// `true` = keep the file, `false` = drop it. Negations work as
// expected: a later `!pattern` re-includes a file that an earlier
// pattern excluded.
//
// Side-effects: filesystem reads only (in `loadGitignorePatterns`).

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Files we attempt to load, in order. Missing files are silently skipped. */
const IGNORE_FILE_NAMES = ['.gitignore', '.ignore', '.rgignore'] as const

/**
 * Load and concatenate raw pattern lines from the standard ignore-file
 * locations at `repoRoot`. Returns lines in source order (later files
 * win, matching how `git` itself layers nested gitignores top-to-bottom).
 *
 * Comments and blank lines are stripped. Patterns are NOT compiled here
 * — callers can inspect / merge the raw list before handing it to
 * {@link createGitignoreFilter}.
 */
export async function loadGitignorePatterns(
  repoRoot: string,
): Promise<string[]> {
  const out: string[] = []
  for (const name of IGNORE_FILE_NAMES) {
    const path = join(repoRoot, name)
    let content: string
    try {
      content = await readFile(path, 'utf8')
    } catch {
      continue
    }
    for (const rawLine of content.split(/\r?\n/)) {
      // Trim trailing whitespace; gitignore allows trailing spaces only
      // when backslash-escaped, which we don't bother with — the
      // path-palette use case never relies on it.
      const line = rawLine.replace(/\s+$/, '')
      if (line.length === 0) continue
      if (line.startsWith('#')) continue
      out.push(line)
    }
  }
  return out
}

/**
 * One compiled rule. `negate` means a match re-includes the path.
 * `dirOnly` means the rule fires only against directory entries —
 * since our walker emits files only, we approximate this by checking
 * whether the rule matches as a prefix of the path.
 */
type CompiledRule = {
  readonly source: string
  readonly negate: boolean
  readonly dirOnly: boolean
  readonly anchored: boolean
  readonly regex: RegExp
}

/**
 * Compile a list of raw gitignore pattern lines into a predicate.
 *
 * Returns a function `(relPath) => boolean` suitable for
 * {@link WalkOptions.shouldInclude}: `true` = include the file,
 * `false` = ignore it. Relative paths must use forward slashes, in
 * line with what the walker emits.
 *
 * Empty pattern list → always-true predicate (everything included).
 */
export function createGitignoreFilter(
  patterns: ReadonlyArray<string>,
): (relPath: string) => boolean {
  const rules: CompiledRule[] = []
  for (const raw of patterns) {
    const compiled = compileRule(raw)
    if (compiled !== null) rules.push(compiled)
  }

  if (rules.length === 0) return () => true

  return (relPath: string): boolean => {
    // Last-rule-wins, like git. We default to "included" and flip on
    // each match: an ignore rule sets `included = false`, a negation
    // sets it back to `true`.
    let included = true
    for (const rule of rules) {
      if (matches(rule, relPath)) {
        included = rule.negate
      }
    }
    return included
  }
}

/**
 * Convenience: load patterns from `repoRoot` and return a ready-to-use
 * predicate. If no ignore files are present, returns an always-true
 * predicate (the walker behaves as if no filter was supplied).
 */
export async function gitignoreFilter(
  repoRoot: string,
): Promise<(relPath: string) => boolean> {
  const patterns = await loadGitignorePatterns(repoRoot)
  return createGitignoreFilter(patterns)
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function compileRule(rawLine: string): CompiledRule | null {
  let line = rawLine
  let negate = false

  if (line.startsWith('!')) {
    negate = true
    line = line.slice(1)
  } else if (line.startsWith('\\!') || line.startsWith('\\#')) {
    // Escaped `!` / `#` — strip the backslash, treat literally.
    line = line.slice(1)
  }

  if (line.length === 0) return null

  let dirOnly = false
  if (line.endsWith('/')) {
    dirOnly = true
    line = line.slice(0, -1)
    if (line.length === 0) return null
  }

  // A pattern is anchored if it contains a `/` anywhere except at the
  // end (the trailing-slash case is already stripped above). A leading
  // `/` is just a marker — strip it before regex compilation.
  let anchored = line.includes('/')
  if (line.startsWith('/')) {
    line = line.slice(1)
    if (line.length === 0) return null
    anchored = true
  }

  const regex = globToRegex(line, anchored, dirOnly)
  if (regex === null) return null

  return {
    source: rawLine,
    negate,
    dirOnly,
    anchored,
    regex,
  }
}

/**
 * Translate a gitignore glob into a regular expression.
 *
 * Anchored patterns are pinned to the start of the relative path;
 * un-anchored patterns are basename matches and may fire at any depth.
 *
 * `dirOnly` patterns match either the dir itself OR anything below it.
 * Because the walker only emits files, "dir itself" never appears in
 * practice — but the `(/.*)?$` suffix still terminates the regex
 * correctly for the "anything below" case.
 */
function globToRegex(
  glob: string,
  anchored: boolean,
  dirOnly: boolean,
): RegExp | null {
  let pattern = ''
  let i = 0
  while (i < glob.length) {
    const ch = glob[i]!

    // Escaped char: take the next char literally.
    if (ch === '\\' && i + 1 < glob.length) {
      pattern += escapeRegex(glob[i + 1]!)
      i += 2
      continue
    }

    // `**` with surrounding `/` — match zero-or-more whole segments.
    if (ch === '*' && glob[i + 1] === '*') {
      // Cases:
      //   `**/`  at start          → match any leading path
      //   `/**/` in the middle     → match any intermediate path
      //   `/**`  at end            → match anything below this point
      //   bare `**`                → same as `*` semantically; we treat
      //                              it as "any chars including /"
      const prevSlash = i > 0 && glob[i - 1] === '/'
      const nextSlash = glob[i + 2] === '/'

      if (prevSlash && nextSlash) {
        // `/foo/**/bar` — consume the `**/` so we don't emit two
        // separate matchers; tail starts at the next char.
        pattern += '(?:.*/)?'
        i += 3
        continue
      }
      if (!prevSlash && nextSlash) {
        // Leading `**/` — match zero-or-more segments at the start.
        pattern += '(?:.*/)?'
        i += 3
        continue
      }
      if (prevSlash && !nextSlash && i + 2 === glob.length) {
        // Trailing `/**` — match anything beneath (including the
        // bare directory case).
        pattern += '.*'
        i += 2
        continue
      }
      // Bare `**` (no surrounding slashes): degrade to greedy `.*`.
      pattern += '.*'
      i += 2
      continue
    }

    if (ch === '*') {
      // Single `*` — match any run of non-slash chars.
      pattern += '[^/]*'
      i += 1
      continue
    }

    if (ch === '?') {
      pattern += '[^/]'
      i += 1
      continue
    }

    pattern += escapeRegex(ch)
    i += 1
  }

  if (pattern.length === 0) return null

  // Anchor & suffix.
  const head = anchored ? '^' : '(?:^|.*/)'
  // For dirOnly patterns, the file must live somewhere *under* the
  // matched dir, so we require a trailing slash followed by any tail.
  // For non-dir-only patterns the pattern can either be the whole path
  // (`$`) or match a directory whose contents we want to ignore
  // (`/.*$`).
  const tail = dirOnly ? '/.*$' : '(?:/.*)?$'

  try {
    return new RegExp(head + pattern + tail)
  } catch {
    return null
  }
}

function matches(rule: CompiledRule, relPath: string): boolean {
  return rule.regex.test(relPath)
}

function escapeRegex(ch: string): string {
  // Note: deliberately escape every non-alphanumeric char to keep this
  // simple and correct. We don't try to minimize the output.
  if (/[a-zA-Z0-9_-]/.test(ch)) return ch
  return '\\' + ch
}
