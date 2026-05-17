// test/core/tools/webFetch.test.ts
//
// Coverage for the enhanced WebFetch tool. All tests stub `globalThis.fetch`
// — no real network. Reset env var + fetch stub between tests.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { WebFetchTool, type WebFetchEnvelope } from '../../../src/core/tools/webFetch'

const baseCtx = () => ({ signal: new AbortController().signal, cwd: process.cwd() })

function makeFetchMock(opts: {
  ok?: boolean
  status?: number
  statusText?: string
  contentType?: string
  body?: string | ArrayBuffer
  finalUrl?: string
  redirected?: boolean
}) {
  return vi.fn().mockResolvedValue({
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    statusText: opts.statusText ?? 'OK',
    url: opts.finalUrl ?? '',
    redirected: opts.redirected ?? false,
    headers: {
      get: (h: string) =>
        h.toLowerCase() === 'content-type'
          ? (opts.contentType ?? 'text/plain')
          : null,
    },
    arrayBuffer: async () => {
      if (opts.body instanceof ArrayBuffer) return opts.body
      return new TextEncoder().encode(opts.body ?? '').buffer
    },
  })
}

beforeEach(() => {
  delete process.env.NUKA_WEBFETCH_ALLOW_LOCAL
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.NUKA_WEBFETCH_ALLOW_LOCAL
})

describe('WebFetchTool — back-compat (default format=auto)', () => {
  it('fetches HTML and converts to Markdown', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      contentType: 'text/html; charset=utf-8',
      body: '<h1>Hello</h1><p>World <strong>bold</strong></p>',
    }))
    const r = await WebFetchTool.run({ url: 'https://example.com' }, baseCtx())
    expect(r.isError).toBe(false)
    expect(typeof r.output).toBe('string')
    expect(r.output as string).toContain('Hello')
    expect(r.output as string).toContain('bold')
  })

  it('returns plain text for non-HTML content type', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      contentType: 'text/plain',
      body: 'plain content here',
    }))
    const r = await WebFetchTool.run({ url: 'https://example.com/file.txt' }, baseCtx())
    expect(r.isError).toBe(false)
    expect(r.output).toBe('plain content here')
  })

  it('auto-formats application/json to pretty JSON', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      contentType: 'application/json',
      body: '{"a":1,"b":[2,3]}',
    }))
    const r = await WebFetchTool.run({ url: 'https://example.com/api' }, baseCtx())
    expect(r.isError).toBe(false)
    expect(r.output as string).toContain('"a": 1')
    expect(r.output as string).toContain('"b": [')
  })

  it('falls back to raw text when server lies about JSON', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      contentType: 'application/json',
      body: 'not valid json {',
    }))
    const r = await WebFetchTool.run({ url: 'https://example.com/api' }, baseCtx())
    expect(r.isError).toBe(false)
    expect(r.output).toBe('not valid json {')
  })
})

describe('WebFetchTool — explicit formats', () => {
  it('format=raw returns body unchanged', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      contentType: 'text/html',
      body: '<h1>Hi</h1>',
    }))
    const r = await WebFetchTool.run(
      { url: 'https://example.com', format: 'raw' },
      baseCtx(),
    )
    expect(r.isError).toBe(false)
    expect(r.output).toBe('<h1>Hi</h1>')
  })

  it('format=text strips HTML tags and decodes entities', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      contentType: 'text/html',
      body: '<p>Hello&nbsp;&amp;&nbsp;<script>evil()</script>world</p>',
    }))
    const r = await WebFetchTool.run(
      { url: 'https://example.com', format: 'text' },
      baseCtx(),
    )
    expect(r.isError).toBe(false)
    const out = r.output as string
    expect(out).toContain('Hello')
    expect(out).toContain('world')
    expect(out).toContain('&')
    expect(out).not.toContain('<')
    expect(out).not.toContain('evil()')
  })

  it('format=markdown forces turndown regardless of Content-Type', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      contentType: 'text/plain',
      body: '<h2>Forced</h2>',
    }))
    const r = await WebFetchTool.run(
      { url: 'https://example.com', format: 'markdown' },
      baseCtx(),
    )
    expect(r.isError).toBe(false)
    expect(r.output as string).toMatch(/Forced/)
  })

  it('format=json parses and re-stringifies', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      contentType: 'text/plain',
      body: '{"k":"v"}',
    }))
    const r = await WebFetchTool.run(
      { url: 'https://example.com', format: 'json' },
      baseCtx(),
    )
    expect(r.isError).toBe(false)
    expect(r.output as string).toContain('"k": "v"')
  })

  it('format=json on invalid JSON returns isError', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      contentType: 'text/plain',
      body: 'not json',
    }))
    const r = await WebFetchTool.run(
      { url: 'https://example.com', format: 'json' },
      baseCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output as string).toContain('not valid JSON')
  })

  it('rejects an unknown format string', async () => {
    vi.stubGlobal('fetch', makeFetchMock({ body: 'x' }))
    const r = await WebFetchTool.run(
      { url: 'https://example.com', format: 'bogus' as unknown as 'auto' },
      baseCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output as string).toMatch(/invalid format/i)
  })
})

describe('WebFetchTool — safety', () => {
  it('rejects file:// scheme without making a network call', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const r = await WebFetchTool.run({ url: 'file:///etc/passwd' }, baseCtx())
    expect(r.isError).toBe(true)
    expect(r.output as string).toMatch(/scheme/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects ftp:// scheme', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const r = await WebFetchTool.run({ url: 'ftp://example.com/x' }, baseCtx())
    expect(r.isError).toBe(true)
    expect(r.output as string).toMatch(/scheme/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects localhost by default', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const r = await WebFetchTool.run({ url: 'http://localhost:3000/admin' }, baseCtx())
    expect(r.isError).toBe(true)
    expect(r.output as string).toMatch(/private|loopback/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects 127.0.0.1 by default', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const r = await WebFetchTool.run({ url: 'http://127.0.0.1:8080' }, baseCtx())
    expect(r.isError).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects RFC1918 10.x by default', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const r = await WebFetchTool.run({ url: 'http://10.0.0.1' }, baseCtx())
    expect(r.isError).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects 192.168.x.x by default', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const r = await WebFetchTool.run({ url: 'http://192.168.1.1' }, baseCtx())
    expect(r.isError).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('allows localhost when NUKA_WEBFETCH_ALLOW_LOCAL=1', async () => {
    process.env.NUKA_WEBFETCH_ALLOW_LOCAL = '1'
    vi.stubGlobal('fetch', makeFetchMock({
      contentType: 'text/plain',
      body: 'ok',
    }))
    const r = await WebFetchTool.run({ url: 'http://localhost:3000/' }, baseCtx())
    expect(r.isError).toBe(false)
    expect(r.output).toBe('ok')
  })

  it('blocks redirect to a private host', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      contentType: 'text/plain',
      body: 'leaked',
      finalUrl: 'http://10.0.0.5/secret',
      redirected: true,
    }))
    const r = await WebFetchTool.run({ url: 'https://example.com/redir' }, baseCtx())
    expect(r.isError).toBe(true)
    expect(r.output as string).toMatch(/redirect blocked/)
  })

  it('rejects an unparseable URL', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const r = await WebFetchTool.run({ url: 'not a url at all' }, baseCtx())
    expect(r.isError).toBe(true)
    expect(r.output as string).toMatch(/invalid URL/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects missing url', async () => {
    const r = await WebFetchTool.run({ url: '' }, baseCtx())
    expect(r.isError).toBe(true)
    expect(r.output as string).toMatch(/missing/)
  })
})

describe('WebFetchTool — limits & errors', () => {
  it('returns error on non-200 response', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    }))
    const r = await WebFetchTool.run({ url: 'https://example.com/missing' }, baseCtx())
    expect(r.isError).toBe(true)
    expect(r.output as string).toContain('404')
    expect(r.output as string).toContain('Not Found')
  })

  it('returns error when response exceeds maxBytes', async () => {
    const bigBody = 'x'.repeat(2000)
    vi.stubGlobal('fetch', makeFetchMock({
      contentType: 'text/plain',
      body: bigBody,
    }))
    const r = await WebFetchTool.run(
      { url: 'https://example.com', maxBytes: 1024 },
      baseCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output as string).toContain('exceeded')
  })

  it('reports network errors with the underlying message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    const r = await WebFetchTool.run({ url: 'https://example.com' }, baseCtx())
    expect(r.isError).toBe(true)
    expect(r.output as string).toMatch(/network error/)
    expect(r.output as string).toContain('ECONNREFUSED')
  })

  it('translates AbortError into a timeout message', async () => {
    const err = new Error('The operation was aborted')
    err.name = 'AbortError'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(err))
    const r = await WebFetchTool.run({ url: 'https://example.com' }, baseCtx())
    expect(r.isError).toBe(true)
    expect(r.output as string).toMatch(/timed out|abort/i)
  })

  it('refuses to send when ctx.signal is already aborted', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const ac = new AbortController()
    ac.abort()
    const r = await WebFetchTool.run(
      { url: 'https://example.com' },
      { signal: ac.signal, cwd: process.cwd() },
    )
    expect(r.isError).toBe(true)
    expect(r.output as string).toMatch(/aborted/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('WebFetchTool — structured output', () => {
  it('returns an envelope when structured=true', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      contentType: 'text/plain',
      body: 'hi',
      finalUrl: 'https://example.com/final',
      redirected: true,
    }))
    const r = await WebFetchTool.run(
      { url: 'https://example.com/start', structured: true },
      baseCtx(),
    )
    expect(r.isError).toBe(false)
    const env = JSON.parse(r.output as string) as WebFetchEnvelope
    expect(env.url).toBe('https://example.com/start')
    expect(env.finalUrl).toBe('https://example.com/final')
    expect(env.status).toBe(200)
    expect(env.contentType).toMatch(/text\/plain/)
    expect(env.content).toBe('hi')
    expect(env.redirected).toBe(true)
    expect(env.redirects).toEqual([
      'https://example.com/start',
      'https://example.com/final',
    ])
  })

  it('omits redirects when none occurred', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      contentType: 'text/plain',
      body: 'hi',
    }))
    const r = await WebFetchTool.run(
      { url: 'https://example.com', structured: true },
      baseCtx(),
    )
    expect(r.isError).toBe(false)
    const env = JSON.parse(r.output as string) as WebFetchEnvelope
    expect(env.redirected).toBe(false)
    expect(env.redirects).toBeUndefined()
  })
})

describe('WebFetchTool — metadata', () => {
  it('declares network permission', () => {
    expect(WebFetchTool.needsPermission({ url: 'https://example.com' })).toBe('network')
  })

  it('is read-only and openWorld', () => {
    expect(WebFetchTool.annotations?.readOnly).toBe(true)
    expect(WebFetchTool.annotations?.openWorld).toBe(true)
  })

  it('carries the core + net.read tags', () => {
    expect(WebFetchTool.tags).toContain('core')
    expect(WebFetchTool.tags).toContain('net.read')
  })
})
