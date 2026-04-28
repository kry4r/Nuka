import { defineTool } from './define'
import { htmlToMarkdown } from './htmlToMarkdown'

export const WebFetchTool = defineTool<{ url: string; maxBytes?: number }>({
  name: 'WebFetch',
  description: 'GET an HTTP(S) URL and return the body. HTML bodies are converted to Markdown.',
  parameters: {
    type: 'object',
    required: ['url'],
    properties: {
      url: { type: 'string' },
      maxBytes: { type: 'integer', minimum: 1024 },
    },
  },
  source: 'builtin',
  tags: ['core', 'net.read'],
  needsPermission: () => 'network',
  async run(input, ctx) {
    const maxBytes = input.maxBytes ?? 1_000_000
    const res = await fetch(input.url, {
      signal: ctx.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'nuka/0.1 (+https://github.com/)' },
    })
    if (!res.ok) {
      return { output: `HTTP ${res.status}: ${res.statusText}`, isError: true }
    }
    const contentType = res.headers.get('content-type') ?? ''
    const buffer = await res.arrayBuffer()
    if (buffer.byteLength > maxBytes) {
      return { output: `response exceeded ${maxBytes} bytes (${buffer.byteLength})`, isError: true }
    }
    const text = new TextDecoder().decode(buffer)
    if (contentType.includes('text/html') || contentType.includes('application/xhtml+xml')) {
      return { output: htmlToMarkdown(text), isError: false }
    }
    return { output: text, isError: false }
  },
})
