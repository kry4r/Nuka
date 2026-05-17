// src/core/urlExtract/urlExtract.ts
//
// URL / link extractor. Pure logic — no React/ink, no LLM, no filesystem.
// Use this whenever you need to scan arbitrary prose (model output, tool
// results, user pastes) and pull out the URLs that show up inside it.
//
// Why a dedicated module? Several call-sites in Nuka want this:
//
//   • Tool-result rendering: highlight or hyperlink URLs that the user
//     can Cmd+Click. The terminal's native scan only fires on
//     contiguous URL-ish runs; we want a single source of truth that
//     also understands prose (`See https://x.com.` → no trailing dot).
//   • Prompt context expansion: when a user pastes a URL the harness
//     may want to fetch it; matching has to be precise enough that a
//     period in `v1.2.3` doesn't masquerade as a domain.
//   • Hyperlink-aware compaction: collapse repeated link text without
//     accidentally rewriting `[text](url)` markdown that another layer
//     will render.
//
// Nuka-Code itself only ships scheme-prefix `isUrl()` checks and a
// per-cell `isUrlChar` for terminal Cmd+Click; nothing like a prose
// extractor. There's no `linkify`-style library in the dependency
// tree of either project, so this is hand-rolled — kept narrow enough
// that we don't have to ship a TLD list or IDN tables.
//
// Coverage:
//
//   • HTTP / HTTPS / FTP / FTPS — full scheme://… capture
//   • `mailto:` URIs and bare `user@host` (when kind 'mailto' enabled)
//   • `file://` URIs (when kind 'file' enabled)
//   • IP-literal hosts, IPv4 dotted-quad and IPv6 bracket form
//   • Trailing punctuation stripped (`.`, `,`, `!`, `?`, `;`, `:` and
//     unbalanced `)`, `]`, `}`, quote chars)
//   • Markdown inline link `[text](url)` and reference-style
//     `[ref]: url` are detected separately so callers can choose to
//     skip them (or flag them via `inMarkdownLink`)
//   • Optional bare-domain mode (off by default): `example.com`,
//     `sub.example.co.uk`, gated on a short popular-TLD allowlist so
//     `v1.2.3` and `foo.bar` (common false positives) don't fire
//
// Out of scope (kept simple deliberately):
//
//   • Full TLD validation — we accept ICANN-style TLD shape but do
//     not ship the IANA list. Bare-domain mode uses a small allowlist.
//   • IDN / punycode normalisation
//   • Percent-encoding round-trip
//   • Schemeful matching of every URI scheme the RFC allows; we
//     stick to the handful that show up in coding agent traffic.

/** A single URL hit inside a larger text. */
export interface UrlMatch {
  /** The extracted URL, with leading/trailing prose stripped. */
  url: string
  /** Inclusive start index into the source string (UTF-16 code units). */
  start: number
  /** Exclusive end index into the source string. */
  end: number
  /** Detected category. Mirrors {@link ExtractUrlOptions.kinds}. */
  kind: UrlKind
  /**
   * True when the match was found inside a markdown link target —
   * either inline (`[text](url)`) or reference-style (`[ref]: url`).
   * Useful for callers that want to skip already-formatted links.
   */
  inMarkdownLink?: boolean
}

/** Recognised URL categories. */
export type UrlKind = 'http' | 'ftp' | 'mailto' | 'file' | 'bare-domain'

/** Options for {@link extractUrls}, {@link isUrl}, {@link replaceUrls}. */
export interface ExtractUrlOptions {
  /**
   * Which kinds of URL to detect. Defaults to
   * `['http', 'ftp', 'mailto']`. Pass `'bare-domain'` to also pick up
   * schemeless host runs (`example.com`); see {@link includeBareDomain}.
   * Pass `'file'` to detect `file://` URIs.
   */
  kinds?: ReadonlyArray<UrlKind>
  /**
   * Shorthand for `kinds: [...kinds, 'bare-domain']`. Defaults to `false`.
   * When `true`, bare hostname runs are emitted with `kind: 'bare-domain'`.
   */
  includeBareDomain?: boolean
  /**
   * Require a scheme prefix on `http` / `ftp` matches. Defaults to `true`.
   * When `false`, the `http`/`ftp` kinds piggy-back on bare-domain
   * matching (and require {@link includeBareDomain} to fire).
   * `mailto` ignores this — emails are scheme-optional by their nature.
   */
  requireScheme?: boolean
}

// --------- public surface ---------

/**
 * Find every URL inside `text` and return them in source order.
 *
 *   extractUrls('Try https://example.com.')
 *     // [{ url: 'https://example.com', start: 4, end: 23, kind: 'http' }]
 *
 *   extractUrls('See [a](https://x.com) or https://y.com')
 *     // 2 matches; the first has inMarkdownLink: true
 */
export function extractUrls(
  text: string,
  opts: ExtractUrlOptions = {},
): UrlMatch[] {
  if (typeof text !== 'string' || text.length === 0) return []

  const cfg = normaliseOptions(opts)
  const matches: UrlMatch[] = []

  // Pass 1: markdown link targets (`[text](url)`) and reference-style
  // `[ref]: url`. We record their character ranges so the prose-scan
  // can tag any URL that falls inside them, and we feed the target
  // strings through the prose extractor so the URL inside the parens
  // gets classified just like a bare URL would.
  const markdownRanges: Array<{ start: number; end: number }> = []
  collectMarkdownLinkTargets(text, cfg, matches, markdownRanges)

  // Pass 2: free-form URLs in the rest of the string. We mask the
  // ranges already consumed by pass 1 (with spaces) so the regex
  // can't double-match the same URL.
  const masked = maskRanges(text, markdownRanges)
  collectFreeUrls(masked, cfg, matches)

  // Stable sort by start offset for caller convenience.
  matches.sort((a, b) => a.start - b.start || a.end - b.end)
  return matches
}

/**
 * Quick check: does `text` contain at least one URL of the configured
 * kinds? Faster than {@link extractUrls} when you only want a boolean.
 */
export function isUrl(text: string, opts: ExtractUrlOptions = {}): boolean {
  if (typeof text !== 'string' || text.length === 0) return false
  // Cheap path: if the whole string looks like a single URL, exit fast.
  const cfg = normaliseOptions(opts)
  const trimmed = text.trim()
  if (trimmed.length === text.length || trimmed.length > 0) {
    const r = matchWholeString(trimmed, cfg)
    if (r) return true
  }
  return extractUrls(text, opts).length > 0
}

/**
 * Map every URL inside `text` through `transform`, returning the
 * rewritten string. Non-URL prose is preserved verbatim. The transform
 * sees the {@link UrlMatch} record so it can branch on `kind` /
 * `inMarkdownLink`.
 *
 *   replaceUrls('See https://x.com.', m => `<${m.url}>`)
 *     // 'See <https://x.com>.'
 */
export function replaceUrls(
  text: string,
  transform: (match: UrlMatch) => string,
  opts: ExtractUrlOptions = {},
): string {
  if (typeof text !== 'string' || text.length === 0) return ''
  const matches = extractUrls(text, opts)
  if (matches.length === 0) return text

  let out = ''
  let cursor = 0
  for (const m of matches) {
    if (m.start < cursor) continue // overlap from sort tiebreak; skip
    out += text.slice(cursor, m.start)
    out += transform(m)
    cursor = m.end
  }
  out += text.slice(cursor)
  return out
}

/** A markdown link parsed out of `[text](url)` or `[ref]: url`. */
export interface MarkdownLink {
  /** The visible text (for inline links) or reference label. */
  text: string
  /** The link target URL. */
  url: string
  /** Inline `[t](u)` vs reference-style `[ref]: u`. */
  style: 'inline' | 'reference'
  /** Start offset of the whole construct (the `[`). */
  start: number
  /** Exclusive end offset of the whole construct. */
  end: number
}

/**
 * Extract markdown links from `text`, in source order.
 *
 *   extractMarkdownLinks('See [docs](https://x.com)')
 *     // [{ text: 'docs', url: 'https://x.com', style: 'inline', ... }]
 *
 *   extractMarkdownLinks('[1]: https://x.com')
 *     // [{ text: '1', url: 'https://x.com', style: 'reference', ... }]
 */
export function extractMarkdownLinks(text: string): MarkdownLink[] {
  if (typeof text !== 'string' || text.length === 0) return []
  const out: MarkdownLink[] = []

  // Inline: `[text](url)`. Allow nested brackets in `text` only up to
  // one level deep (good enough for prose; we don't try to be a full
  // CommonMark parser). The URL may be quoted or unquoted; we accept
  // anything that doesn't contain whitespace inside the parens, then
  // strip any trailing `"title"` clause if present.
  const inline = /\[((?:[^\]\\]|\\.)*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/g
  for (const m of text.matchAll(inline)) {
    if (m.index === undefined) continue
    out.push({
      text: m[1] ?? '',
      url: m[2] ?? '',
      style: 'inline',
      start: m.index,
      end: m.index + m[0].length,
    })
  }

  // Reference-style at line start: `   [ref]: url   "optional title"`.
  // Anchored to line beginning; tolerant of 0-3 leading spaces per
  // CommonMark.
  const ref = /(?:^|\n)([ \t]{0,3})\[([^\]]+)\]:[ \t]+(\S+)(?:[ \t]+"[^"]*")?/g
  for (const m of text.matchAll(ref)) {
    if (m.index === undefined) continue
    // Skip the leading newline (if any) in the captured offset.
    const leadingNewline = m[0].startsWith('\n') ? 1 : 0
    const start = m.index + leadingNewline
    out.push({
      text: m[2] ?? '',
      url: m[3] ?? '',
      style: 'reference',
      start,
      end: m.index + m[0].length,
    })
  }

  out.sort((a, b) => a.start - b.start)
  return out
}

// --------- internals ---------

interface NormalisedOptions {
  kinds: Set<UrlKind>
  requireScheme: boolean
}

function normaliseOptions(opts: ExtractUrlOptions): NormalisedOptions {
  const baseKinds = opts.kinds ?? (['http', 'ftp', 'mailto'] as const)
  const kinds = new Set<UrlKind>(baseKinds)
  if (opts.includeBareDomain) kinds.add('bare-domain')
  const requireScheme = opts.requireScheme ?? true
  return { kinds, requireScheme }
}

/**
 * Popular TLD allowlist for bare-domain mode. The full IANA list is a
 * moving target (~1500 entries); shipping it inflates the module and
 * adds maintenance, while the false-positive cost of accepting any
 * 2-6-letter trailing run is high (`v1.foo`, `file.bin`, etc.). This
 * conservative set covers nearly every URL that turns up in coding
 * agent traffic.
 */
const POPULAR_TLDS = new Set([
  // generic
  'com',
  'org',
  'net',
  'io',
  'dev',
  'app',
  'ai',
  'co',
  'info',
  'biz',
  'me',
  'us',
  'tv',
  'cc',
  'xyz',
  'tech',
  'cloud',
  'sh',
  'so',
  'edu',
  'gov',
  'mil',
  'int',
  // country (popular)
  'uk',
  'de',
  'fr',
  'jp',
  'cn',
  'ru',
  'br',
  'in',
  'au',
  'ca',
  'ch',
  'nl',
  'it',
  'es',
  'se',
  'no',
  'fi',
  'dk',
  'pl',
  'kr',
  'tw',
  'hk',
])

/**
 * Master scheme regex. Anchored at scheme prefix, captures URL-safe
 * bytes only. The character class is the RFC 3986 unreserved + reserved
 * set (minus whitespace and angle-bracket / quote delimiters), plus
 * any Unicode letter/number/mark so IRIs (`https://example.com/路径`)
 * survive. We stop at any character outside that set so a sentence
 * like `https://a.com,https://b.com` splits cleanly into two URLs.
 * Trailing prose punctuation that *is* legal inside a URL (`.`, `?`,
 * `!`) is shaved off by {@link trimTrailingPunct}.
 */
const URL_BODY_CHARS = "A-Za-z0-9\\-._~!$&'()*+;=:@/?#%\\[\\]"
const SCHEME_URL_RE = new RegExp(
  `(?:https?|ftps?|file):\\/\\/(?:[${URL_BODY_CHARS}]|\\p{L}|\\p{N}|\\p{M})+`,
  'giu',
)

const MAILTO_URI_RE = /mailto:[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+(?:\.[A-Za-z]{2,24})+/gi

const EMAIL_RE =
  /(?<![A-Za-z0-9._+-])[A-Za-z0-9_!#$%&'*+/=?`{|}~^.-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?![A-Za-z0-9-])/g

// Bare domain: at least one dot, last label letters-only and present in
// POPULAR_TLDS. Followed by optional path/query/fragment. Negative
// look-behind avoids matching the host inside an already-captured
// scheme URL (`https://example.com`) or an email (`a@example.com`).
const BARE_DOMAIN_RE =
  /(?<![A-Za-z0-9.@:/-])(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+([A-Za-z]{2,24})(?::\d{1,5})?(?:\/[^\s]*)?/g

/**
 * Markdown link discovery — populates `matches` with the URL *inside*
 * the link target (tagged with `inMarkdownLink: true`) and records
 * the outer-construct ranges in `markdownRanges` so the free-scan can
 * mask them out.
 */
function collectMarkdownLinkTargets(
  text: string,
  cfg: NormalisedOptions,
  matches: UrlMatch[],
  markdownRanges: Array<{ start: number; end: number }>,
): void {
  for (const link of extractMarkdownLinks(text)) {
    markdownRanges.push({ start: link.start, end: link.end })

    // Locate the URL inside the original text — for inline links
    // (`[t](url)`) it lives after the first `(` after `link.start`;
    // for reference (`[ref]: url`) after the first `:` then whitespace.
    let urlStart: number
    if (link.style === 'inline') {
      const open = text.indexOf('(', link.start)
      if (open === -1) continue
      urlStart = open + 1
      // Skip any whitespace between `(` and url (rare but legal).
      while (urlStart < text.length && /\s/.test(text[urlStart] ?? '')) {
        urlStart += 1
      }
    } else {
      const colon = text.indexOf(':', link.start)
      if (colon === -1) continue
      urlStart = colon + 1
      while (urlStart < text.length && /[ \t]/.test(text[urlStart] ?? '')) {
        urlStart += 1
      }
    }

    if (link.url.length === 0) continue
    const urlEnd = urlStart + link.url.length
    const kind = classifyUrl(link.url, cfg)
    if (!kind) continue
    matches.push({
      url: link.url,
      start: urlStart,
      end: urlEnd,
      kind,
      inMarkdownLink: true,
    })
  }
}

/**
 * Run the scheme/email/bare-domain scans on `text` (already masked).
 * Appends to `matches` (caller sorts).
 */
function collectFreeUrls(
  text: string,
  cfg: NormalisedOptions,
  matches: UrlMatch[],
): void {
  if (cfg.kinds.has('http') || cfg.kinds.has('ftp') || cfg.kinds.has('file')) {
    for (const m of text.matchAll(SCHEME_URL_RE)) {
      if (m.index === undefined) continue
      const raw = m[0]
      const trimmed = trimTrailingPunct(raw)
      const kind = schemeKind(trimmed)
      if (!kind || !cfg.kinds.has(kind)) continue
      matches.push({
        url: trimmed,
        start: m.index,
        end: m.index + trimmed.length,
        kind,
      })
    }
  }

  if (cfg.kinds.has('mailto')) {
    for (const m of text.matchAll(MAILTO_URI_RE)) {
      if (m.index === undefined) continue
      const trimmed = trimTrailingPunct(m[0])
      matches.push({
        url: trimmed,
        start: m.index,
        end: m.index + trimmed.length,
        kind: 'mailto',
      })
    }
    // Bare emails (no scheme).
    for (const m of text.matchAll(EMAIL_RE)) {
      if (m.index === undefined) continue
      // Skip if this email is the host part of a mailto: just matched
      // above — we'd double-count `mailto:a@b.com`'s `a@b.com`.
      if (
        m.index >= 7 &&
        text.slice(m.index - 7, m.index).toLowerCase() === 'mailto:'
      ) {
        continue
      }
      matches.push({
        url: m[0],
        start: m.index,
        end: m.index + m[0].length,
        kind: 'mailto',
      })
    }
  }

  if (cfg.kinds.has('bare-domain')) {
    for (const m of text.matchAll(BARE_DOMAIN_RE)) {
      if (m.index === undefined) continue
      const tld = (m[1] ?? '').toLowerCase()
      if (!POPULAR_TLDS.has(tld)) continue
      const trimmed = trimTrailingPunct(m[0])
      // Avoid swallowing the local-part of an email — if there's an `@`
      // immediately before the match, this is really an email tail.
      if (m.index > 0 && text[m.index - 1] === '@') continue
      matches.push({
        url: trimmed,
        start: m.index,
        end: m.index + trimmed.length,
        kind: 'bare-domain',
      })
    }
  }
}

/**
 * Quick whole-string classifier — used by {@link isUrl}'s fast path.
 * Returns the kind if `text` looks like exactly one URL.
 */
function matchWholeString(
  text: string,
  cfg: NormalisedOptions,
): UrlKind | undefined {
  // Scheme URL covering the whole string?
  const scheme = /^(?:https?|ftps?|file):\/\/\S+$/i.exec(text)
  if (scheme) {
    const kind = schemeKind(text)
    if (kind && cfg.kinds.has(kind)) return kind
  }
  if (cfg.kinds.has('mailto')) {
    if (/^mailto:\S+$/i.test(text)) return 'mailto'
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return 'mailto'
  }
  return undefined
}

/**
 * Map a scheme-prefixed URL to its {@link UrlKind}. Returns `undefined`
 * if the scheme is unknown.
 */
function schemeKind(url: string): UrlKind | undefined {
  const lower = url.toLowerCase()
  if (lower.startsWith('http://') || lower.startsWith('https://')) return 'http'
  if (lower.startsWith('ftp://') || lower.startsWith('ftps://')) return 'ftp'
  if (lower.startsWith('file://')) return 'file'
  if (lower.startsWith('mailto:')) return 'mailto'
  return undefined
}

/**
 * Classify an arbitrary URL string (used by the markdown-link pass,
 * which feeds us already-extracted targets). Falls back through:
 * scheme → mailto → bare email → bare domain.
 */
function classifyUrl(
  url: string,
  cfg: NormalisedOptions,
): UrlKind | undefined {
  const scheme = schemeKind(url)
  if (scheme && cfg.kinds.has(scheme)) return scheme
  if (cfg.kinds.has('mailto')) {
    if (/^mailto:/i.test(url)) return 'mailto'
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(url)) return 'mailto'
  }
  if (cfg.kinds.has('bare-domain')) {
    const m = /^([A-Za-z0-9-]+\.)+([A-Za-z]{2,24})(?:[:/?#]|$)/.exec(url)
    if (m) {
      const tld = (m[2] ?? '').toLowerCase()
      if (POPULAR_TLDS.has(tld)) return 'bare-domain'
    }
  }
  return undefined
}

/**
 * Trailing-punctuation trimmer. Strips terminal punctuation that's
 * almost certainly prose (period at end of sentence, comma, !, ?, ;,
 * :) and balances unbalanced closing brackets/quotes. Symmetric with
 * the way users write URLs inline: `(see https://x.com)` and `Hi
 * https://x.com.` both keep `https://x.com` clean.
 */
function trimTrailingPunct(s: string): string {
  let out = s
  // Iteratively strip — `https://x.com).` should become `https://x.com`
  // after two passes.
  // Cap at a reasonable iteration count so a pathological input can't
  // spin forever; in practice 2-3 passes is the max we ever need.
  for (let i = 0; i < 6; i++) {
    const next = stripOneTrailing(out)
    if (next === out) break
    out = next
  }
  return out
}

const TRAILING_PUNCT_RE = /[.,!?;:]$/

function stripOneTrailing(s: string): string {
  if (s.length === 0) return s
  // Plain trailing prose punctuation.
  if (TRAILING_PUNCT_RE.test(s)) return s.slice(0, -1)
  const last = s[s.length - 1] ?? ''
  // Unbalanced closers: only strip if the matching opener does not
  // appear inside `s`. This keeps the `(` in
  // `https://en.wikipedia.org/wiki/Foo_(bar)` intact.
  if (last === ')' && !s.includes('(')) return s.slice(0, -1)
  if (last === ']' && !s.includes('[')) return s.slice(0, -1)
  if (last === '}' && !s.includes('{')) return s.slice(0, -1)
  // Trailing quote chars are always prose around the URL.
  if (last === '"' || last === "'" || last === '`' || last === '>') {
    return s.slice(0, -1)
  }
  return s
}

/**
 * Replace each [start, end) range in `text` with spaces of the same
 * length, so the free-form scan can run on a string of identical
 * length without re-matching the masked ranges. Spaces are deliberate:
 * they break URL/scheme/email regex runs and preserve character
 * offsets, which the caller depends on for `start`/`end`.
 */
function maskRanges(
  text: string,
  ranges: Array<{ start: number; end: number }>,
): string {
  if (ranges.length === 0) return text
  const chars = text.split('')
  for (const { start, end } of ranges) {
    for (let i = start; i < end && i < chars.length; i++) {
      chars[i] = ' '
    }
  }
  return chars.join('')
}
