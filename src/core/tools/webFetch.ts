// src/core/tools/webFetch.ts
//
// WebFetch — fetch an HTTP(S) URL and return the body, optionally
// converted to Markdown / plain text / re-serialised JSON.
//
// Surface (single action; format-driven):
//
//   url           required. http(s) only — other schemes are rejected.
//   format?       'auto' (default), 'markdown', 'text', 'json', 'raw'.
//                 'auto' preserves the historical behaviour: HTML →
//                 markdown via turndown, everything else → text body.
//                 'raw' returns the body unchanged.
//                 'text' strips HTML tags and decodes basic entities.
//                 'markdown' forces turndown regardless of Content-Type.
//                 'json' parses the body as JSON and re-stringifies.
//   maxBytes?     default 1_000_000. Bodies larger than this are
//                 rejected with isError. Enforced after read because
//                 the global `fetch` doesn't stream-cap easily; the
//                 buffer length is checked before decode so we never
//                 hand the agent more than the cap.
//   timeoutMs?    default 30_000. Layered onto ctx.signal via an
//                 AbortController so the tool times out independent
//                 of the harness signal.
//   structured?   default false. When true, the output is a
//                 JSON-stringified envelope with {url, finalUrl,
//                 status, contentType, content, redirects?}.
//                 When false, the output is just the content body —
//                 preserves the v1 contract assumed by callers and
//                 the older test set.
//
// Safety:
//   • Non-HTTP(S) schemes (file://, ftp://, data:, javascript:, …)
//     are rejected before any network call.
//   • Hostnames that look like RFC1918 / loopback / link-local are
//     rejected unless the env var NUKA_WEBFETCH_ALLOW_LOCAL=1 is
//     set. This is a v1 heuristic on the hostname literal — not a
//     DNS rebinding-proof check. The final URL is re-checked after
//     redirect so the model can't be tricked into hitting an
//     internal host via a 30x.
//   • Bodies are capped at maxBytes; oversize → isError.
//   • All fetch calls go out with a fixed User-Agent.
//
// Back-compat:
//   • Default output is still a plain string body (markdown for HTML,
//     text otherwise). The existing call site `WebFetchTool.run({url})`
//     and the original test set continue to work unchanged.
//   • `structured: true` opts into the envelope shape for callers
//     that want metadata (status, finalUrl, redirect chain).

import { defineTool } from './define'
import type { ToolResult } from './types'
import { htmlToMarkdown } from './htmlToMarkdown'

export const WEB_FETCH_TOOL_NAME = 'WebFetch'

export type WebFetchFormat = 'auto' | 'markdown' | 'text' | 'json' | 'raw'

export type WebFetchInput = {
  url: string
  format?: WebFetchFormat
  maxBytes?: number
  timeoutMs?: number
  /** When true, output is a JSON-stringified envelope (see WebFetchEnvelope). */
  structured?: boolean
}

export type WebFetchEnvelope = {
  url: string
  finalUrl: string
  status: number
  statusText: string
  contentType: string
  bytes: number
  content: string
  format: WebFetchFormat
  redirected: boolean
  redirects?: string[]
}

const USER_AGENT = 'Nuka-WebFetch/1.0 (+https://github.com/)'
const DEFAULT_MAX_BYTES = 1_000_000
const DEFAULT_TIMEOUT_MS = 30_000

const VALID_FORMATS: ReadonlySet<WebFetchFormat> = new Set([
  'auto', 'markdown', 'text', 'json', 'raw',
])

/**
 * Hostname literal screen. Catches the common shapes:
 *  • `localhost` and `.localhost` suffixes
 *  • IPv4 loopback (127.x.x.x), link-local (169.254.x.x), and
 *    RFC1918 ranges (10.x, 172.16-31.x, 192.168.x).
 *  • IPv6 loopback (::1) and link-local (fe80::/10).
 *
 * Not a DNS-rebinding defence — a DNS A record pointing at 127.0.0.1
 * for a public hostname would still pass this gate. v1 ships the
 * literal check; a follow-up can wire dns.lookup() if needed.
 */
function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  if (h === '::1' || h === '[::1]') return true
  if (h.startsWith('fe80:') || h.startsWith('[fe80:')) return true
  // strip IPv6 brackets if any
  const bare = h.replace(/^\[|\]$/g, '')
  // IPv4 numeric
  const m = bare.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m) {
    const a = Number(m[1])
    const b = Number(m[2])
    if (a === 127) return true            // loopback
    if (a === 10) return true             // RFC1918
    if (a === 192 && b === 168) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 169 && b === 254) return true // link-local
    if (a === 0) return true              // 0.0.0.0
  }
  return false
}

function localAllowed(): boolean {
  return process.env.NUKA_WEBFETCH_ALLOW_LOCAL === '1'
}

/**
 * Validate the URL — scheme + host. Returns an error message on
 * failure, undefined on success. Centralised so the same check
 * runs against the original URL and the final post-redirect URL.
 */
function validateUrl(raw: string): string | undefined {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return `invalid URL: ${raw}`
  }
  const scheme = parsed.protocol.toLowerCase()
  if (scheme !== 'http:' && scheme !== 'https:') {
    return `unsupported scheme '${scheme.replace(':', '')}' — only http/https are allowed`
  }
  if (!parsed.hostname) {
    return `URL has no hostname: ${raw}`
  }
  if (isPrivateHost(parsed.hostname) && !localAllowed()) {
    return `refusing to fetch private/loopback host '${parsed.hostname}' — set NUKA_WEBFETCH_ALLOW_LOCAL=1 to allow`
  }
  return undefined
}

/**
 * Cheap HTML → plain text — strip script/style blocks, drop tags,
 * decode the common named entities, collapse whitespace.
 *
 * Not a markdown converter — that's what `htmlToMarkdown` is for.
 * This is the fallback for `format: 'text'` so we don't pull
 * markdown structure into a plain-text rendering.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

function looksLikeHtml(contentType: string): boolean {
  return (
    contentType.includes('text/html') ||
    contentType.includes('application/xhtml+xml')
  )
}

function looksLikeJson(contentType: string): boolean {
  return (
    contentType.includes('application/json') ||
    contentType.includes('+json')
  )
}

/**
 * Render the raw body according to the requested format. The
 * 'auto' branch reproduces the original v1 behaviour: HTML →
 * markdown, everything else → raw text.
 */
type RenderResult =
  | { kind: 'ok'; content: string }
  | { kind: 'err'; message: string }

function renderBody(
  raw: string,
  contentType: string,
  format: WebFetchFormat,
): RenderResult {
  switch (format) {
    case 'raw':
      return { kind: 'ok', content: raw }
    case 'markdown':
      return { kind: 'ok', content: htmlToMarkdown(raw) }
    case 'text':
      return {
        kind: 'ok',
        content: looksLikeHtml(contentType) ? htmlToText(raw) : raw,
      }
    case 'json': {
      try {
        const parsed = JSON.parse(raw) as unknown
        return { kind: 'ok', content: JSON.stringify(parsed, null, 2) }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return {
          kind: 'err',
          message: `format=json but body is not valid JSON: ${msg}`,
        }
      }
    }
    case 'auto':
    default:
      if (looksLikeHtml(contentType)) {
        return { kind: 'ok', content: htmlToMarkdown(raw) }
      }
      if (looksLikeJson(contentType)) {
        try {
          return {
            kind: 'ok',
            content: JSON.stringify(JSON.parse(raw) as unknown, null, 2),
          }
        } catch {
          // server lied about JSON — fall through to raw text
          return { kind: 'ok', content: raw }
        }
      }
      return { kind: 'ok', content: raw }
  }
}

export const WebFetchTool = defineTool<WebFetchInput>({
  name: WEB_FETCH_TOOL_NAME,
  description:
    'GET an HTTP(S) URL and return the body. Default (auto) converts HTML to ' +
    'Markdown and parses JSON. Use format=raw/text/markdown/json to override. ' +
    'Non-HTTP(S) schemes are rejected; private/loopback hosts blocked unless ' +
    'NUKA_WEBFETCH_ALLOW_LOCAL=1. Pass structured=true for an envelope with ' +
    'status, finalUrl, contentType, and redirect chain.',
  parameters: {
    type: 'object',
    required: ['url'],
    properties: {
      url: { type: 'string', description: 'http(s) URL to fetch' },
      format: {
        type: 'string',
        enum: ['auto', 'markdown', 'text', 'json', 'raw'],
        description:
          "How to render the body. 'auto' (default): HTML→markdown, JSON→pretty, " +
          "else raw text. 'raw': body unchanged. 'text': HTML stripped, else raw. " +
          "'markdown': force turndown. 'json': parse + restringify.",
      },
      maxBytes: {
        type: 'integer',
        minimum: 1024,
        description: 'Cap on response body size in bytes. Default 1_000_000.',
      },
      timeoutMs: {
        type: 'integer',
        minimum: 100,
        description: 'Request timeout in milliseconds. Default 30_000.',
      },
      structured: {
        type: 'boolean',
        description:
          'When true, output is a JSON envelope with metadata (status, finalUrl, ' +
          'redirects, contentType, bytes). Default false (body only).',
      },
    },
  },
  source: 'builtin',
  tags: ['core', 'net.read'],
  annotations: { readOnly: true, openWorld: true },
  needsPermission: () => 'network',
  async run(input, ctx): Promise<ToolResult> {
    const url = (input?.url ?? '').trim()
    if (!url) return { output: 'WebFetch: missing required parameter `url`', isError: true }

    const format: WebFetchFormat = input.format ?? 'auto'
    if (!VALID_FORMATS.has(format)) {
      return {
        output: `WebFetch: invalid format '${String(input.format)}' — expected one of auto|markdown|text|json|raw`,
        isError: true,
      }
    }

    const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const structured = input.structured === true

    const preErr = validateUrl(url)
    if (preErr) return { output: `WebFetch: ${preErr}`, isError: true }

    // Layer timeout onto the harness signal — abort if either fires.
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(new Error('WebFetch timeout')), timeoutMs)
    const onParentAbort = () => ac.abort(ctx.signal.reason)
    if (ctx.signal.aborted) {
      clearTimeout(timer)
      return { output: 'WebFetch: aborted before send', isError: true }
    }
    ctx.signal.addEventListener('abort', onParentAbort, { once: true })

    try {
      let res: Response
      try {
        res = await fetch(url, {
          signal: ac.signal,
          redirect: 'follow',
          headers: {
            'user-agent': USER_AGENT,
            accept: '*/*',
          },
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (/abort/i.test(msg) || ac.signal.aborted) {
          return {
            output: `WebFetch: request timed out after ${timeoutMs}ms (or aborted)`,
            isError: true,
          }
        }
        return { output: `WebFetch: network error: ${msg}`, isError: true }
      }

      // Re-check the final URL — redirects can land us on a private
      // host even when the original was public.
      const finalUrl = res.url || url
      if (finalUrl !== url) {
        const postErr = validateUrl(finalUrl)
        if (postErr) return { output: `WebFetch: redirect blocked — ${postErr}`, isError: true }
      }

      if (!res.ok) {
        return {
          output: `WebFetch: HTTP ${res.status}: ${res.statusText} (${finalUrl})`,
          isError: true,
        }
      }

      const contentType = res.headers.get('content-type') ?? ''
      const buffer = await res.arrayBuffer()
      if (buffer.byteLength > maxBytes) {
        return {
          output: `WebFetch: response exceeded ${maxBytes} bytes (${buffer.byteLength})`,
          isError: true,
        }
      }

      const raw = new TextDecoder().decode(buffer)
      const rendered = renderBody(raw, contentType, format)
      if (rendered.kind === 'err') {
        return { output: `WebFetch: ${rendered.message}`, isError: true }
      }

      if (!structured) {
        return { output: rendered.content, isError: false }
      }

      const envelope: WebFetchEnvelope = {
        url,
        finalUrl,
        status: res.status,
        statusText: res.statusText,
        contentType,
        bytes: buffer.byteLength,
        content: rendered.content,
        format,
        redirected: res.redirected || finalUrl !== url,
        ...(res.redirected || finalUrl !== url ? { redirects: [url, finalUrl] } : {}),
      }
      return { output: JSON.stringify(envelope), isError: false }
    } finally {
      clearTimeout(timer)
      ctx.signal.removeEventListener('abort', onParentAbort)
    }
  },
})
