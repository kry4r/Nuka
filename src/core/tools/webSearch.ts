import type { Tool } from './types'
import { defineTool } from './define'

export type SearchEndpointConfig = {
  endpoint: string
  apiKey?: string
  authHeader?: string
  authPrefix?: string
}

const UA = 'nuka/0.1 (+https://github.com/)'
const DDG_ENDPOINT = 'https://html.duckduckgo.com/html/?q={query}'

type Hit = { title: string; url: string; snippet?: string }

/**
 * Decode common HTML entities found in DuckDuckGo HTML output.
 */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x2F;/g, '/')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
}

/**
 * DDG HTML wraps the real target in `/l/?uddg=<encoded>&...`. Unwrap it so
 * we hand the model the actual destination URL.
 */
function unwrapDdgUrl(href: string): string {
  try {
    const u = href.startsWith('//') ? `https:${href}` : href
    const parsed = new URL(u, 'https://duckduckgo.com')
    if (parsed.pathname === '/l/' || parsed.pathname.endsWith('/l/')) {
      const target = parsed.searchParams.get('uddg')
      if (target) return decodeURIComponent(target)
    }
    return parsed.toString()
  } catch {
    return href
  }
}

/**
 * Extract the top N result rows out of DuckDuckGo's HTML-only endpoint.
 * Avoids running the entire page through turndown — most of that markup is
 * chrome and would just inflate the tool result.
 */
function parseDuckDuckGoHtml(html: string, limit = 8): Hit[] {
  const hits: Hit[] = []
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]+class="result__a"|$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) && hits.length < limit) {
    const rawHref = m[1] ?? ''
    const rawTitle = m[2] ?? ''
    const tail = m[3] ?? ''
    const url = unwrapDdgUrl(decodeEntities(rawHref))
    const title = stripTags(rawTitle)
    const snipMatch = tail.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/)
    const snippet = snipMatch && snipMatch[1] ? stripTags(snipMatch[1]) : undefined
    if (url && title) hits.push({ title, url, snippet })
  }
  return hits
}

function formatHits(query: string, hits: Hit[]): string {
  const lines = [`Web search results for "${query}":`, '']
  hits.forEach((h, i) => {
    lines.push(`${i + 1}. [${h.title}](${h.url})`)
    if (h.snippet) lines.push(`   ${h.snippet}`)
  })
  lines.push('')
  lines.push('When citing these results to the user, include the URLs as markdown links.')
  return lines.join('\n')
}

export function makeWebSearchTool(cfg: SearchEndpointConfig | undefined): Tool<{ query: string }> {
  return defineTool<{ query: string }>({
    name: 'WebSearch',
    description: 'Search the web. Uses configured search.endpoint when set, otherwise falls back to DuckDuckGo. Returns ranked results as markdown links.',
    parameters: {
      type: 'object',
      required: ['query'],
      properties: { query: { type: 'string', minLength: 1 } },
    },
    source: 'builtin',
    tags: ['core', 'net.read'],
    annotations: { readOnly: true, openWorld: true },
    needsPermission: () => 'network',
    async run(input, ctx) {
      const query = (input.query ?? '').trim()
      if (!query) return { output: 'Error: empty query', isError: true }

      ctx.onProgress?.(`Searching for "${query}"`)

      // 1) User-configured endpoint takes precedence — preserves prior behaviour.
      if (cfg) {
        const url = cfg.endpoint.replace('{query}', encodeURIComponent(query))
        const headers: Record<string, string> = { accept: 'application/json', 'user-agent': UA }
        if (cfg.apiKey) {
          const h = cfg.authHeader ?? 'Authorization'
          const prefix = cfg.authPrefix ?? 'Bearer '
          headers[h] = `${prefix}${cfg.apiKey}`
        }
        try {
          const res = await fetch(url, { signal: ctx.signal, headers })
          if (!res.ok) return { output: `HTTP ${res.status}: ${res.statusText}`, isError: true }
          const text = await res.text()
          return { output: text, isError: false }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return { output: `Search request failed: ${msg}`, isError: true }
        }
      }

      // 2) Default fallback: DuckDuckGo HTML — no API key required.
      const url = DDG_ENDPOINT.replace('{query}', encodeURIComponent(query))
      try {
        const res = await fetch(url, {
          signal: ctx.signal,
          redirect: 'follow',
          headers: {
            accept: 'text/html,application/xhtml+xml',
            'accept-language': 'en-US,en;q=0.9',
            'user-agent': UA,
          },
        })
        if (!res.ok) {
          return {
            output: `Default search backend returned HTTP ${res.status}. Configure \`search.endpoint\` for a custom provider.`,
            isError: true,
          }
        }
        const html = await res.text()
        const hits = parseDuckDuckGoHtml(html)
        if (hits.length === 0) {
          return {
            output: `No results parsed for "${query}". The default backend layout may have changed; consider configuring \`search.endpoint\`.`,
            isError: true,
          }
        }
        ctx.onProgress?.(`Found ${hits.length} results`)
        return { output: formatHits(query, hits), isError: false }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { output: `Search request failed: ${msg}`, isError: true }
      }
    },
  })
}
