// src/core/slug/slug.ts
//
// Slug / safe-name helpers. Pure string transformation — no React/ink,
// no LLM, no filesystem. Use these wherever you need to convert an
// arbitrary string (user input, a scratch description, a session ID,
// a git ref) into a constrained identifier — URL-safe, filename-safe,
// or git-branch-safe.
//
// Nuka-Code already inlines several variants of this idea
// (`sanitizeName` in `swarm/teamHelpers.ts`, `tasks.ts`, and
// `safeFilenameId` in `bridge/sessionRunner.ts`), each with its own
// per-call regex. This module collects them into a single tested
// surface so future call-sites can converge without each one
// re-deciding what "safe" means.
//
// Three strictness tiers, picked by which export you call:
//
//   slugify(s)        — strict URL slug: [a-z0-9] + separator only.
//   safeFilename(s)   — POSIX-portable filename: drops `/ \ : * ? " < > |`,
//                       null bytes, and other forbidden chars, but keeps
//                       case, dots, underscores. Preserves the trailing
//                       extension by default.
//   safeBranchName(s) — git ref-name rules per `git check-ref-format`:
//                       no `..`, `~`, `^`, `:`, `?`, `*`, `[`, `\`, no
//                       leading `/`, no trailing `.lock`, etc.
//
// Unicode handling: by default ASCII-only output. We normalize with
// NFKD and drop combining marks, which collapses accented Latin
// (`café` → `cafe`) but leaves non-Latin scripts (CJK, Cyrillic, etc.)
// as a sequence of disallowed codepoints that the strict filter then
// strips. Pass `unicode: true` to preserve any Unicode letter / digit
// (matched via `\p{L}` / `\p{N}`) and only normalize separators.
//
// All public functions are total — they always return a string. Empty
// input or input that contains nothing keepable returns `''`; callers
// that need a non-empty fallback should supply one explicitly.

/** Lazy grapheme segmenter, used only when truncating Unicode output. */
let cachedSegmenter: Intl.Segmenter | null = null
function segmenter(): Intl.Segmenter {
  if (!cachedSegmenter) {
    cachedSegmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })
  }
  return cachedSegmenter
}

/** Options for {@link slugify}. */
export interface SlugOptions {
  /**
   * Character used to join the kept words. Single char only — multi-char
   * separators would collide with the collapse pass. Defaults to `'-'`.
   */
  separator?: string
  /**
   * Lower-case the output. Only meaningful when `unicode` is true, since
   * the strict ASCII path already produces lowercase; flipping this to
   * false on the strict path is a no-op. Defaults to `true`.
   */
  lower?: boolean
  /**
   * Strict ASCII slug. When `true` (default), everything outside
   * `[a-z0-9]` (after NFKD-strip) is replaced by the separator. When
   * `false`, only the explicit reject set ({@link STRICT_REJECT_RE}) is
   * replaced — useful when you want a slug-shape but care about
   * preserving more characters than `[a-z0-9]` (e.g. `.` in version
   * tags).
   */
  strict?: boolean
  /**
   * Preserve Unicode letters and digits (`\p{L}`/`\p{N}`). When `true`,
   * `café résumé` survives as `café-résumé`; CJK and Cyrillic survive
   * too. Overrides `strict` — Unicode mode is its own filter.
   * Defaults to `false`.
   */
  unicode?: boolean
  /**
   * Maximum length of the result, in UTF-16 code units. Truncation
   * never lands on a trailing separator. Defaults to `Infinity`.
   */
  maxLength?: number
}

/**
 * Characters always replaced in non-strict mode. These are the union
 * of POSIX-shell-unsafe and URL-unsafe punctuation; everything else
 * (letters, digits, `.`, `_`, `-`) is preserved.
 */
const STRICT_REJECT_RE = /[\s/\\?#%&=+:;,'"`<>!@$^*(){}[\]|]/g

/**
 * Convert `text` into a URL-safe slug.
 *
 *   slugify('Hello World')              // 'hello-world'
 *   slugify('Café résumé')               // 'cafe-resume'
 *   slugify('Café résumé',
 *           { unicode: true })          // 'café-résumé'
 *   slugify('  foo___bar  ')             // 'foo-bar'
 *   slugify('a.b.c', { strict: false }) // 'a.b.c'
 *   slugify('Very long title',
 *           { maxLength: 8 })           // 'very'         (clean at boundary)
 */
export function slugify(text: string, opts: SlugOptions = {}): string {
  if (typeof text !== 'string' || text.length === 0) return ''

  const {
    separator = '-',
    lower = true,
    strict = true,
    unicode = false,
    maxLength = Infinity,
  } = opts

  validateSeparator(separator)
  if (!Number.isFinite(maxLength) && maxLength !== Infinity) {
    throw new RangeError(
      `maxLength must be a finite number or Infinity, got ${maxLength}`,
    )
  }
  if (maxLength < 0) {
    throw new RangeError(`maxLength must be ≥ 0, got ${maxLength}`)
  }

  let out: string
  if (unicode) {
    // Replace anything that isn't a Unicode letter or digit with the
    // separator. We deliberately do NOT NFKD-strip here — the whole
    // point of unicode-mode is to keep accents and non-Latin scripts.
    out = text.replace(/[^\p{L}\p{N}]+/gu, separator)
  } else {
    // Normalize accented Latin to base + combining marks, then drop
    // the marks. `\p{M}` matches all combining marks (Mn/Mc/Me).
    const ascii = text.normalize('NFKD').replace(/\p{M}+/gu, '')
    if (strict) {
      // Keep only ASCII letters/digits; everything else → separator.
      out = ascii.replace(/[^a-zA-Z0-9]+/g, separator)
    } else {
      // Looser: only the explicit reject set is replaced. We then
      // collapse adjacent separators so multiple rejects in a row don't
      // bloat the result.
      out = ascii.replace(STRICT_REJECT_RE, separator)
      const escaped = escapeRegExp(separator)
      out = out.replace(new RegExp(`${escaped}{2,}`, 'g'), separator)
    }
  }

  if (lower) out = out.toLowerCase()

  // Trim leading/trailing separator(s).
  out = trimSeparator(out, separator)

  // Length cap.
  if (out.length > maxLength) {
    out = truncateNoTrailingSeparator(out, maxLength, separator)
  }

  return out
}

/** Options for {@link safeFilename}. */
export interface SafeFilenameOptions {
  /**
   * Maximum total length of the result, measured in UTF-16 code units
   * (matches what the filesystem actually counts). 255 is the
   * conservative POSIX `NAME_MAX`. Defaults to `255`.
   */
  maxLength?: number
  /**
   * Replacement character for forbidden bytes. Must be a single char
   * that is itself safe — we validate that it doesn't appear in the
   * forbidden set. Defaults to `'_'`.
   */
  replacement?: string
  /**
   * When `true` (default), preserve the trailing `.ext` and only
   * sanitize the stem. The dot stays where it was. When `false`, the
   * entire string including the dot is sanitized as one unit.
   */
  preserveExtension?: boolean
}

/**
 * Forbidden filename characters across Windows + POSIX. Windows is the
 * strict superset, so this is the union of `/ \ : * ? " < > |` plus
 * the C0 control range U+0000-U+001F and DEL (U+007F). Note: space
 * itself is *not* in this set — POSIX allows spaces in filenames and
 * Windows tolerates them too (`My Doc.txt` is fine).
 */
const FILENAME_FORBIDDEN_RE = buildForbiddenFilenameRe()

function buildForbiddenFilenameRe(): RegExp {
  // Compose explicitly so the source bytes of this file remain ASCII
  // — easier on grep and on reviewers than embedding literal NULs.
  const ctrl = '\\u0000-\\u001F\\u007F'
  const punct = '/\\\\:*?"<>|'
  return new RegExp(`[${ctrl}${punct}]`, 'g')
}

/**
 * Windows reserved device names (case-insensitive). Files literally
 * named `CON`, `PRN`, `AUX`, `NUL`, `COM1`-`COM9`, `LPT1`-`LPT9` are
 * unopenable on Windows even with a different extension.
 */
const WIN_RESERVED_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i

/**
 * Sanitize `text` into a string usable as a cross-platform filename.
 * Unlike {@link slugify}, this preserves case, dots, underscores, and
 * the original Unicode letters — only the strictly forbidden bytes are
 * stripped. The default trailing-extension preservation keeps `.txt`,
 * `.tar.gz` (the last `.ext` only), etc. intact.
 *
 *   safeFilename('My Doc.txt')           // 'My Doc.txt'
 *   safeFilename('a/b\\c?d.txt')         // 'a_b_c_d.txt'
 *   safeFilename('CON.txt')              // '_CON.txt'
 *   safeFilename('café résumé.pdf')      // 'café résumé.pdf'
 *   safeFilename('x'.repeat(500))        // truncated to 255
 */
export function safeFilename(
  text: string,
  opts: SafeFilenameOptions = {},
): string {
  if (typeof text !== 'string' || text.length === 0) return ''

  const {
    maxLength = 255,
    replacement = '_',
    preserveExtension = true,
  } = opts

  if (replacement.length !== 1) {
    throw new RangeError(
      `replacement must be a single character, got "${replacement}" (length ${replacement.length})`,
    )
  }
  const isForbiddenChar = new RegExp(FILENAME_FORBIDDEN_RE.source).test(
    replacement,
  )
  if (isForbiddenChar) {
    throw new RangeError(
      `replacement "${replacement}" is itself a forbidden filename character`,
    )
  }
  if (maxLength < 1) {
    throw new RangeError(`maxLength must be ≥ 1, got ${maxLength}`)
  }

  // Split into stem + ext (last `.` only; leading dot doesn't count
  // as extension — `.bashrc` is a stem).
  let stem = text
  let ext = ''
  if (preserveExtension) {
    const lastDot = text.lastIndexOf('.')
    if (lastDot > 0 && lastDot < text.length - 1) {
      stem = text.slice(0, lastDot)
      ext = text.slice(lastDot) // includes the dot
    }
  }

  // Sanitize stem and ext separately so the dot survives even when
  // the stem contains forbidden chars next to it.
  stem = sanitizeFilenamePart(stem, replacement)
  if (ext) ext = sanitizeFilenamePart(ext, replacement)

  // Strip trailing dots/spaces from the stem — Windows trims these on
  // open, which can cause "file not found" surprises.
  stem = stem.replace(/[. ]+$/g, '')

  // Avoid Windows reserved device names by prefixing the replacement
  // character. We check on the *sanitized* stem + ext so a name like
  // `CON/file.txt` (which becomes `CON_file.txt`) doesn't trip it.
  let combined = stem + ext
  if (WIN_RESERVED_RE.test(combined)) {
    combined = replacement + combined
  }

  // Empty after sanitize? Caller asked for something we couldn't make
  // safe — return empty so the caller can detect & fallback.
  if (combined.length === 0) return ''

  // Length cap. Trim the stem, not the extension (so `.txt` stays).
  if (combined.length > maxLength) {
    const room = Math.max(1, maxLength - ext.length)
    const stemCut = stem.slice(0, room)
    combined = stemCut + ext
    // Pathological: extension itself exceeds maxLength. Hard-cut.
    if (combined.length > maxLength) {
      combined = combined.slice(0, maxLength)
    }
  }

  return combined
}

/**
 * Per-part filename sanitizer. Replaces forbidden bytes with the
 * replacement and collapses runs of replacement chars (so a Windows
 * path like `a/\\b` doesn't turn into `a__b`).
 */
function sanitizeFilenamePart(part: string, replacement: string): string {
  // Build a fresh regex per call — FILENAME_FORBIDDEN_RE is stateful
  // (/g + .lastIndex) and we don't want call-site interactions.
  const re = new RegExp(FILENAME_FORBIDDEN_RE.source, 'g')
  let out = part.replace(re, replacement)
  const escaped = escapeRegExp(replacement)
  out = out.replace(new RegExp(`${escaped}{2,}`, 'g'), replacement)
  return out
}

/** Options for {@link safeBranchName}. */
export interface SafeBranchOptions {
  /**
   * Replacement for forbidden characters. Must be one of git's
   * always-safe chars (letters, digits, `-`, `_`, `.`). Defaults to `'-'`.
   */
  replacement?: string
  /**
   * Maximum total length. Git itself has no documented limit but
   * filesystems often cap at ~250. Defaults to `200`.
   */
  maxLength?: number
}

/**
 * Git's documented forbidden characters in ref names
 * (`git check-ref-format`):
 *   - Whitespace and control characters
 *   - `~`, `^`, `:`, `?`, `*`, `[`, `\`
 * Plus implicit rules handled separately below:
 *   - No `..` sequence
 *   - No leading or trailing `/`
 *   - No double `//`
 *   - No trailing `.lock`
 *   - No trailing `.`
 *   - No leading `-` (would look like a flag to git CLI)
 */
const BRANCH_FORBIDDEN_RE = buildForbiddenBranchRe()

function buildForbiddenBranchRe(): RegExp {
  const ctrl = '\\u0000-\\u001F\\u007F'
  const ws = '\\s'
  const punct = '~^:?*\\[\\\\'
  return new RegExp(`[${ctrl}${ws}${punct}]`, 'g')
}

const BRANCH_SAFE_REPLACEMENT_RE = /^[\w.-]$/

/**
 * Sanitize `text` into a string usable as a git branch / ref name.
 *
 *   safeBranchName('feat: my thing')      // 'feat-my-thing'
 *   safeBranchName('foo..bar')             // 'foo-bar'
 *   safeBranchName('hotfix/x~y')           // 'hotfix/x-y'
 *   safeBranchName('.hidden')              // 'hidden'
 *   safeBranchName('mybranch.lock')        // 'mybranch'
 *   safeBranchName('--force-push')         // 'force-push'
 *
 * Forward slashes are preserved — git uses them as namespace separators
 * (`feat/foo`). Leading/trailing/double slashes are stripped.
 */
export function safeBranchName(
  text: string,
  opts: SafeBranchOptions = {},
): string {
  if (typeof text !== 'string' || text.length === 0) return ''

  const { replacement = '-', maxLength = 200 } = opts

  if (replacement.length !== 1) {
    throw new RangeError(
      `replacement must be a single character, got "${replacement}" (length ${replacement.length})`,
    )
  }
  if (!BRANCH_SAFE_REPLACEMENT_RE.test(replacement)) {
    throw new RangeError(
      `replacement "${replacement}" is not a git-safe character — use one of [A-Za-z0-9_.-]`,
    )
  }
  if (maxLength < 1) {
    throw new RangeError(`maxLength must be ≥ 1, got ${maxLength}`)
  }

  // Fresh regex per call; the module-level one is /g + stateful.
  const re = new RegExp(BRANCH_FORBIDDEN_RE.source, 'g')
  let out = text.replace(re, replacement)

  // Eliminate `..` sequences — git rejects these (they'd be parsed as
  // a revision range). Replace with a single replacement char.
  while (out.includes('..')) {
    out = out.replace(/\.\./g, replacement)
  }

  // Collapse adjacent `/` (git rejects `//`).
  out = out.replace(/\/+/g, '/')

  // Collapse runs of the replacement.
  const escaped = escapeRegExp(replacement)
  out = out.replace(new RegExp(`${escaped}{2,}`, 'g'), replacement)

  // Strip leading/trailing `/`, leading `.`, leading `-`, and trailing
  // `.` (git rules + a usability tweak so a branch can't shadow a flag).
  out = out.replace(/^[/.\-]+/, '').replace(/[/.]+$/, '')

  // Strip trailing `.lock` (git reserves these).
  while (/\.lock$/i.test(out)) {
    out = out.replace(/\.lock$/i, '')
  }

  // Re-trim — stripping `.lock` may have exposed new trailing punctuation.
  out = out.replace(/[/.]+$/, '')

  // Length cap.
  if (out.length > maxLength) {
    out = truncateNoTrailingSeparator(out, maxLength, replacement)
  }

  return out
}

// -------- internal helpers --------

/**
 * Validate that `separator` is exactly one character. Multi-char
 * separators would collide with the multi-separator collapse pass and
 * the trim-at-end pass, so we reject early with a clear message.
 */
function validateSeparator(separator: string): void {
  if (separator.length !== 1) {
    throw new RangeError(
      `separator must be a single character, got "${separator}" (length ${separator.length})`,
    )
  }
}

/** Strip leading/trailing runs of `separator` from `s`. */
function trimSeparator(s: string, separator: string): string {
  if (s.length === 0) return s
  const escaped = escapeRegExp(separator)
  return s.replace(new RegExp(`^${escaped}+|${escaped}+$`, 'g'), '')
}

/**
 * Truncate `s` to at most `maxLength` UTF-16 code units, ensuring the
 * result never ends in `separator` (the caller almost never wants a
 * dangling dash). If trimming the trailing separator drops us below
 * `maxLength`, that's fine — we prefer "shorter and clean" over
 * "exactly at the cap with a trailing punctuation".
 *
 * Iterates graphemes so a max-cap that lands inside a surrogate pair
 * or ZWJ cluster falls back to the cluster boundary just before it.
 */
function truncateNoTrailingSeparator(
  s: string,
  maxLength: number,
  separator: string,
): string {
  if (maxLength <= 0) return ''
  if (s.length <= maxLength) return s

  // Walk graphemes until we hit the budget.
  let out = ''
  for (const { segment } of segmenter().segment(s)) {
    if (out.length + segment.length > maxLength) break
    out += segment
  }

  return trimSeparator(out, separator)
}

/**
 * Escape a literal string for use inside a RegExp. We need this for
 * `separator` and `replacement` which arrive from the public API — a
 * caller could (legally) pass `'.'` or `'+'` as a separator.
 */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
