import type { Tool } from './types'
import { defineTool } from './define'

export type SearchEndpointConfig = {
  endpoint: string
  apiKey?: string
  authHeader?: string
  authPrefix?: string
}

export function makeWebSearchTool(cfg: SearchEndpointConfig | undefined): Tool<{ query: string }> {
  return defineTool<{ query: string }>({
    name: 'WebSearch',
    description: 'Search the web via the configured search provider. Returns a plain-text summary.',
    parameters: {
      type: 'object',
      required: ['query'],
      properties: { query: { type: 'string' } },
    },
    source: 'builtin',
    tags: ['core', 'net.read'],
    needsPermission: () => 'network',
    async run(input, ctx) {
      if (!cfg) return { output: 'WebSearch is not configured. Set `search.endpoint` in config.', isError: true }
      const url = cfg.endpoint.replace('{query}', encodeURIComponent(input.query))
      const headers: Record<string, string> = { accept: 'application/json' }
      if (cfg.apiKey) {
        const h = cfg.authHeader ?? 'Authorization'
        const prefix = cfg.authPrefix ?? 'Bearer '
        headers[h] = `${prefix}${cfg.apiKey}`
      }
      const res = await fetch(url, { signal: ctx.signal, headers })
      if (!res.ok) return { output: `HTTP ${res.status}: ${res.statusText}`, isError: true }
      const text = await res.text()
      return { output: text, isError: false }
    },
  })
}
