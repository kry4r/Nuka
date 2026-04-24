import { describe, it, expect, vi, afterEach } from 'vitest'
import { WebFetchTool } from '../../../src/core/tools/webFetch'

const ctx = { signal: new AbortController().signal, cwd: process.cwd() }

function makeFetchMock(opts: {
  ok: boolean
  status?: number
  statusText?: string
  contentType?: string
  body?: string | ArrayBuffer
}) {
  return vi.fn().mockResolvedValue({
    ok: opts.ok,
    status: opts.status ?? 200,
    statusText: opts.statusText ?? 'OK',
    headers: {
      get: (h: string) => (h === 'content-type' ? (opts.contentType ?? 'text/plain') : null),
    },
    arrayBuffer: async () => {
      if (opts.body instanceof ArrayBuffer) return opts.body
      return new TextEncoder().encode(opts.body ?? '').buffer
    },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('WebFetchTool', () => {
  it('fetches HTML and converts to Markdown', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      ok: true,
      contentType: 'text/html; charset=utf-8',
      body: '<h1>Hello</h1><p>World <strong>bold</strong></p>',
    }))
    const r = await WebFetchTool.run({ url: 'https://example.com' }, ctx)
    expect(r.isError).toBe(false)
    expect(r.output).toContain('Hello')
    expect(r.output).toContain('bold')
  })

  it('returns plain text for non-HTML content type', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      ok: true,
      contentType: 'text/plain',
      body: 'plain content here',
    }))
    const r = await WebFetchTool.run({ url: 'https://example.com/file.txt' }, ctx)
    expect(r.isError).toBe(false)
    expect(r.output).toBe('plain content here')
  })

  it('returns error on non-200 response', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    }))
    const r = await WebFetchTool.run({ url: 'https://example.com/missing' }, ctx)
    expect(r.isError).toBe(true)
    expect(r.output).toContain('404')
    expect(r.output).toContain('Not Found')
  })

  it('returns error when response exceeds maxBytes', async () => {
    const bigBody = 'x'.repeat(2000)
    vi.stubGlobal('fetch', makeFetchMock({
      ok: true,
      contentType: 'text/plain',
      body: bigBody,
    }))
    const r = await WebFetchTool.run({ url: 'https://example.com', maxBytes: 1024 }, ctx)
    expect(r.isError).toBe(true)
    expect(r.output).toContain('exceeded')
  })

  it('declares network permission', () => {
    expect(WebFetchTool.needsPermission({ url: 'https://example.com' })).toBe('network')
  })
})
