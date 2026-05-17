// src/core/jsonEscape/jsonEscape.ts
//
// String-transformation escape helpers for embedding plain strings into
// six common host contexts: JSON, POSIX shell, regex literal, HTML body,
// URL component, and Markdown body text.
//
// Pure logic — no React/ink, no LLM, no filesystem, no global state.
//
// Why a dedicated module? Each of these domains has a small, well-defined
// escape rule, but the bytes that need escaping differ per domain, the
// edge cases differ per domain, and the consequences of getting it wrong
// (command injection, XSS, malformed JSON …) are domain-specific. Folding
// "escape stuff" into one Mom-bag function is exactly how prompt-injection
// and shell-injection bugs ship. Every helper here is single-purpose and
// the test surface covers the exact edge cases per domain.
//
// Compatibility notes:
//
//   • escapeJSON(text) returns the BODY of a JSON string literal — it
//     does NOT include surrounding quotes. Use quoteJSON for that.
//     Equivalent of `JSON.stringify(text).slice(1, -1)` but allocation-
//     and surrogate-pair correct.
//
//   • Shell quoting is POSIX (sh / bash / zsh) only. cmd.exe / PowerShell
//     have entirely different rules and are not supported here — caller
//     should build argv arrays for them, not strings. We document the
//     skip in `quoteShellWindows` (throws).
//
//   • escapeRegex is for use INSIDE a `new RegExp(`${here}`)` body — it
//     escapes regex metacharacters so the produced string matches its
//     literal source. Use `inCharClass: true` when the result will sit
//     inside a `[...]` character class (escapes `-` and `^` too).
//
//   • escapeHtml escapes the three structural chars `<`, `>`, `&` by
//     default. Pass `{ quote: true }` to also escape `'` and `"` for
//     attribute-value contexts. `unescapeHtml` reverses the same five
//     plus numeric entities (`&#39;`, `&#x27;`); it deliberately does
//     NOT decode the full HTML5 named-entity table (that's a 2000+
//     entry list — `he` package territory). Named entities that the
//     unescape doesn't recognise are passed through verbatim.
//
//   • URL escape uses `encodeURIComponent` as the floor, then tightens
//     to RFC 3986 by also escaping `!*'()` (which `encodeURIComponent`
//     leaves alone for legacy reasons). `encodeQueryComponent` further
//     swaps `%20` for `+` for application/x-www-form-urlencoded bodies.
//
//   • Markdown escape escapes the GFM punctuation that has structural
//     meaning in inline body text: `\\`, ``, `*`, `_`, `{`, `}`, `[`,
//     `]`, `(`, `)`, `#`, `+`, `-`, `.`, `!`, `|`, `>`. Pass
//     `context: 'code'` to disable all escaping (text inside a fenced
//     or inline code span is taken literally by Markdown — escaping
//     would just leak backslashes into the rendered output).
//
// Idempotency is NOT a property of any escape helper here: applying
// `escapeJSON` twice double-escapes, applying `escapeRegex` twice
// further escapes the literal backslashes, and so on. The tests pin
// this down so a future refactor doesn't silently change behaviour.

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

/**
 * Escape a string for embedding inside a JSON string literal. Returns
 * the *body* — the surrounding `"…"` are NOT included.
 *
 * Handles:
 *   • the seven specially-named escapes `\"`, `\\`, `\/`, `\b`, `\f`,
 *     `\n`, `\r`, `\t` (forward slash is escaped to `\/` so the
 *     result is safe to embed inside a `</script>` tag in HTML)
 *   • the C0 control range U+0000..U+001F via `\u00XX`
 *   • U+007F DEL via `` (DEL is technically a printable byte
 *     under the JSON spec but invariably causes terminal mischief)
 *   • U+2028 LINE SEPARATOR and U+2029 PARAGRAPH SEPARATOR via ` `
 *     / ` ` — JSON allows these unescaped, but JavaScript prior to
 *     ES2019 did not, and many tools that round-trip JSON through `eval`
 *     break on them. Cheap defence.
 *
 * Surrogate pairs are passed through verbatim — well-formed UTF-16 is
 * legal JSON.
 *
 * Idempotency: NOT idempotent. `escapeJSON(escapeJSON('a"b'))` doubles
 * the backslashes. Always escape exactly once.
 */
export function escapeJSON(text: string): string {
  // Fast-path: ascii-no-special. If we don't hit any byte that needs
  // escaping in a forward scan, return the original string.
  let needsEscape = false
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (
      code < 0x20 || // C0 controls
      code === 0x22 || // "
      code === 0x2f || // /
      code === 0x5c || // \
      code === 0x7f || // DEL
      code === 0x2028 ||
      code === 0x2029
    ) {
      needsEscape = true
      break
    }
  }
  if (!needsEscape) return text

  let out = ''
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code === 0x22) {
      out += '\\"'
    } else if (code === 0x5c) {
      out += '\\\\'
    } else if (code === 0x2f) {
      out += '\\/'
    } else if (code === 0x08) {
      out += '\\b'
    } else if (code === 0x09) {
      out += '\\t'
    } else if (code === 0x0a) {
      out += '\\n'
    } else if (code === 0x0c) {
      out += '\\f'
    } else if (code === 0x0d) {
      out += '\\r'
    } else if (code < 0x20 || code === 0x7f) {
      out += '\\u' + code.toString(16).padStart(4, '0')
    } else if (code === 0x2028) {
      out += '\\u2028'
    } else if (code === 0x2029) {
      out += '\\u2029'
    } else {
      // Single code unit append (surrogate halves pass through; well-
      // formed surrogate pairs reconstitute on the consumer side).
      out += text[i]
    }
  }
  return out
}

/**
 * Escape and wrap a string for use as a JSON string literal. Equivalent
 * to `JSON.stringify(text)` for the same input — same escapes, same
 * surrounding quotes — but routes through the local escapeJSON which
 * additionally escapes `/`, U+2028, U+2029, and DEL.
 */
export function quoteJSON(text: string): string {
  return '"' + escapeJSON(text) + '"'
}

// ---------------------------------------------------------------------------
// POSIX shell
// ---------------------------------------------------------------------------

/**
 * Options for {@link quoteShell}.
 */
export interface QuoteShellOptions {
  /**
   * Quoting style.
   *   • `'auto'` (default) — emit a single-quoted form when the input
   *     contains no single quote; otherwise emit a double-quoted form
   *     with `$`, `` ` ``, `"`, and `\` escaped to prevent expansion.
   *     Empty strings always emit as `''`.
   *   • `'single'` — force a single-quoted form. Any embedded `'` is
   *     emitted as the canonical bash workaround `'\''` (close the
   *     single-quoted run, emit an escaped single quote, reopen).
   *   • `'double'` — force a double-quoted form with `$`, `` ` ``,
   *     `"`, `\` escaped. Newlines pass through (legal in `bash` —
   *     the resulting line continues into the next line).
   */
  style?: 'auto' | 'single' | 'double'
}

const SHELL_SAFE_RE = /^[A-Za-z0-9_./@%+=:,-]+$/

/**
 * Quote a single string for use as one shell argument under POSIX
 * shells (sh, bash, zsh, dash).
 *
 * Examples:
 *   quoteShell('hello')             → 'hello'           (already safe)
 *   quoteShell('hello world')       → "'hello world'"
 *   quoteShell("it's")              → "'it'\\''s'"      (canonical bash)
 *   quoteShell('$HOME')             → "'$HOME'"         (no expansion)
 *   quoteShell('')                  → "''"
 *   quoteShell('a', { style:'double' }) → '"a"'
 *
 * Idempotency: NOT idempotent — quoting an already-quoted string adds
 * another layer.
 */
export function quoteShell(arg: string, opts: QuoteShellOptions = {}): string {
  const style = opts.style ?? 'auto'
  if (arg.length === 0) return "''"

  if (style === 'double') {
    return quoteShellDouble(arg)
  }
  if (style === 'single') {
    return quoteShellSingle(arg)
  }
  // auto
  // If every byte is in the safe set, return unquoted.
  if (SHELL_SAFE_RE.test(arg)) return arg
  // No single quote in input → cheapest correct form is single-quoting.
  if (arg.indexOf("'") === -1) return "'" + arg + "'"
  // Contains a single quote → fall back to the canonical bash escape.
  return quoteShellSingle(arg)
}

function quoteShellSingle(arg: string): string {
  // Replace every ' with '\'' (close, escaped quote, reopen).
  return "'" + arg.replace(/'/g, "'\\''") + "'"
}

function quoteShellDouble(arg: string): string {
  // Escape $, `, ", \ — these are the only bytes that have special
  // meaning inside `"..."` under POSIX. Single quotes do not need
  // escaping; newlines, spaces, tabs etc. pass through verbatim.
  return '"' + arg.replace(/[\\$`"]/g, '\\$&') + '"'
}

/**
 * Quote an argv array for use as a single shell command line. Each
 * element is passed through {@link quoteShell} individually and joined
 * with a single space.
 *
 * Example:
 *   quoteShellArray(['echo', 'hello world', "it's"])
 *     → "echo 'hello world' 'it'\\''s'"
 */
export function quoteShellArray(
  args: ReadonlyArray<string>,
  opts: QuoteShellOptions = {},
): string {
  return args.map(a => quoteShell(a, opts)).join(' ')
}

/**
 * Windows cmd.exe quoting is intentionally NOT implemented. cmd.exe
 * uses entirely different metacharacters (`%`, `^`, `&`, `<`, `>`,
 * `|`, `"`) and quoting rules that depend on the receiving program's
 * own argv parsing (CommandLineToArgvW differs from MSVCRT's parser).
 *
 * The right thing on Windows is to spawn the child process with an
 * argv array, not a quoted command string. If you genuinely need a
 * cmd.exe-safe quoted command string, use a dedicated library
 * (e.g. `shell-quote` is POSIX-only too — try `windows-cmd-shim`
 * or hand-roll for your specific receiver).
 *
 * @throws Always — call out for the caller to fix at the source.
 */
export function quoteShellWindows(_arg: string): never {
  throw new Error(
    'quoteShellWindows is intentionally unimplemented — pass an argv array to the child process spawn API instead of a quoted string',
  )
}

// ---------------------------------------------------------------------------
// Regex
// ---------------------------------------------------------------------------

/**
 * Options for {@link escapeRegex}.
 */
export interface EscapeRegexOptions {
  /**
   * If `true`, also escape `-` and `^` so the result can sit safely
   * inside a `[...]` character class. The dash is special only between
   * two character literals, but the simplest correct behaviour is to
   * escape it whenever inside a class. Defaults to `false`.
   */
  inCharClass?: boolean
}

const REGEX_META_RE = /[.*+?^${}()|[\]\\]/g
const REGEX_META_CHARCLASS_RE = /[.*+?^${}()|[\]\\\-]/g

/**
 * Escape regex metacharacters so the result can be embedded literally
 * inside a `new RegExp` pattern.
 *
 *   escapeRegex('a.b')       → 'a\\.b'
 *   escapeRegex('a+b*c')     → 'a\\+b\\*c'
 *   escapeRegex('a-z', { inCharClass: true }) → 'a\\-z'
 *
 * Idempotency: NOT idempotent — backslash itself is in the escape set,
 * so a second pass would double every backslash.
 */
export function escapeRegex(text: string, opts: EscapeRegexOptions = {}): string {
  const re = opts.inCharClass ? REGEX_META_CHARCLASS_RE : REGEX_META_RE
  return text.replace(re, '\\$&')
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

/**
 * Options for {@link escapeHtml}.
 */
export interface EscapeHtmlOptions {
  /**
   * If `true`, also escape `'` (→ `&#39;`) and `"` (→ `&quot;`) so the
   * result is safe inside a quoted attribute value. Defaults to `false`
   * — content escaping for body text only.
   */
  quote?: boolean
}

/**
 * Escape the structural HTML characters `<`, `>`, `&` (and, if
 * `quote: true`, also `'` and `"`).
 *
 *   escapeHtml('<b>&"\'</b>')                    → '&lt;b&gt;&amp;"\'&lt;/b&gt;'
 *   escapeHtml('<b>&"\'</b>', { quote: true })   → '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;'
 *
 * `&` is escaped first so already-encoded entities in the input do not
 * get double-escaped *incorrectly* — they DO get double-encoded by
 * design, because this function treats input as a *literal* string,
 * not as HTML. The string `"&amp;"` is round-tripped to `"&amp;amp;"`
 * on purpose. Use {@link unescapeHtml} first if the input may already
 * be HTML-encoded.
 *
 * Unicode passes through verbatim.
 *
 * Idempotency: NOT idempotent — `&` re-escapes on a second pass.
 */
export function escapeHtml(text: string, opts: EscapeHtmlOptions = {}): string {
  let out = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  if (opts.quote) {
    out = out.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  }
  return out
}

const NAMED_ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

/**
 * Inverse of {@link escapeHtml} for the entities this module emits
 * (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;`, `&apos;`, `&#x27;`),
 * plus `&nbsp;` and any numeric entity in the BMP range (`&#NNNN;` or
 * `&#xHHHH;`).
 *
 * Unrecognised named entities (e.g. `&copy;`) are passed through
 * verbatim — this is NOT a general-purpose HTML5 entity decoder.
 *
 * Idempotency: `unescapeHtml(unescapeHtml(x))` is the same as
 * `unescapeHtml(x)` for inputs that contain no live entities — but
 * mixed inputs are not idempotent in general (e.g. `"&amp;lt;"`
 * decodes to `"&lt;"` on the first pass and `"<"` on the second).
 */
export function unescapeHtml(text: string): string {
  return text.replace(
    /&(?:#x([0-9A-Fa-f]+)|#(\d+)|([A-Za-z][A-Za-z0-9]*));/g,
    (full, hex: string | undefined, dec: string | undefined, name: string | undefined) => {
      if (hex !== undefined) {
        const code = parseInt(hex, 16)
        if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return full
        return safeFromCodePoint(code, full)
      }
      if (dec !== undefined) {
        const code = parseInt(dec, 10)
        if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return full
        return safeFromCodePoint(code, full)
      }
      if (name !== undefined) {
        const mapped = NAMED_ENTITY_MAP[name]
        return mapped ?? full
      }
      return full
    },
  )
}

function safeFromCodePoint(code: number, fallback: string): string {
  try {
    return String.fromCodePoint(code)
  } catch {
    return fallback
  }
}

// ---------------------------------------------------------------------------
// URL
// ---------------------------------------------------------------------------

/**
 * RFC 3986 path-component encoding. Uses `encodeURIComponent` as the
 * baseline and additionally encodes the characters that JavaScript's
 * built-in legacy-leaves-alone — `!`, `*`, `'`, `(`, `)` — so the
 * result is safe inside a path segment (no quirky-vs-strict server
 * mismatches).
 *
 * Reserved-but-encoded characters (`/`, `?`, `#`, `&`, `=`, `+`, ` `,
 * etc.) are all percent-encoded. Already-encoded input (`%2F`) is
 * itself percent-encoded a second time (`%252F`); this matches
 * `encodeURIComponent` and is the safe default — the caller decides
 * whether the input was raw or already encoded.
 *
 * Idempotency: NOT idempotent — `%` re-encodes as `%25` on a second pass.
 */
export function encodePathComponent(text: string): string {
  return encodeURIComponent(text).replace(
    /[!*'()]/g,
    c => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  )
}

/**
 * Inverse of {@link encodePathComponent}. Delegates to
 * `decodeURIComponent`; malformed sequences throw URIError.
 */
export function decodePathComponent(text: string): string {
  return decodeURIComponent(text)
}

/**
 * application/x-www-form-urlencoded encoding. Same as
 * {@link encodePathComponent} but the space character is encoded as
 * `+` rather than `%20`. Use for query-string values that will be
 * decoded with `URLSearchParams` or a CGI-style parser.
 */
export function encodeQueryComponent(text: string): string {
  return encodePathComponent(text).replace(/%20/g, '+')
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

/**
 * Options for {@link escapeMarkdown}.
 */
export interface EscapeMarkdownOptions {
  /**
   * Embedding context.
   *   • `'inline'` (default) — escape inline-Markdown punctuation so
   *     the result renders as the original literal text inside a
   *     normal paragraph.
   *   • `'code'` — emit the input verbatim. Markdown takes the
   *     contents of a fenced or inline code span as literal text,
   *     so escaping would leak backslashes into the rendered output.
   */
  context?: 'inline' | 'code'
}

// GFM-aware inline metacharacters. We escape the union of CommonMark
// and GFM punctuation that has structural meaning when found at the
// start of a line OR inline. Conservative; over-escaping is safe and
// renders to the same text.
const MARKDOWN_META_RE = /[\\`*_{}\[\]()#+\-.!|>~]/g

/**
 * Escape Markdown punctuation so the result renders as the original
 * literal text inside a paragraph.
 *
 *   escapeMarkdown('*bold*')            → '\\*bold\\*'
 *   escapeMarkdown('a_b_c')             → 'a\\_b\\_c'
 *   escapeMarkdown('1. ordered')        → '1\\. ordered'
 *   escapeMarkdown('# heading')         → '\\# heading'
 *   escapeMarkdown('back`tick')         → 'back\\`tick'
 *   escapeMarkdown('keep`as`is', { context: 'code' }) → 'keep`as`is'
 *
 * Idempotency: NOT idempotent — `\` itself is in the escape set.
 */
export function escapeMarkdown(
  text: string,
  opts: EscapeMarkdownOptions = {},
): string {
  if (opts.context === 'code') return text
  return text.replace(MARKDOWN_META_RE, '\\$&')
}
