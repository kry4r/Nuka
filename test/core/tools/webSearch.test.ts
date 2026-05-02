import { describe, it, expect, vi, afterEach } from 'vitest'
import { makeWebSearchTool } from '../../../src/core/tools/webSearch'

const ctx = { signal: new AbortController().signal, cwd: process.cwd() }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('makeWebSearchTool', () => {
  it('falls back to the default backend when cfg is undefined', async () => {
    let capturedUrl: string | undefined
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      capturedUrl = url
      const html = `
        <a class="result__a" href="https://duckduckgo.com/l/?uddg=${encodeURIComponent('https://example.com/')}&rut=x">Example Site</a>
        <a class="result__snippet" href="#">Example snippet text</a>
        <a class="result__a" href="https://duckduckgo.com/l/?uddg=${encodeURIComponent('https://example.org/')}&rut=y">Org Site</a>
        <a class="result__snippet" href="#">Org snippet</a>
      `
      return Promise.resolve({ ok: true, status: 200, text: async () => html })
    }))
    const tool = makeWebSearchTool(undefined)
    const r = await tool.run({ query: 'hello world' }, ctx)
    expect(r.isError).toBe(false)
    expect(capturedUrl).toContain('duckduckgo.com')
    expect(capturedUrl).toContain('hello%20world')
    const out = String(r.output)
    expect(out).toContain('[Example Site](https://example.com/)')
    expect(out).toContain('[Org Site](https://example.org/)')
  })

  it('returns an error when the default backend is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
    }))
    const tool = makeWebSearchTool(undefined)
    const r = await tool.run({ query: 'test' }, ctx)
    expect(r.isError).toBe(true)
    expect(r.output).toContain('429')
  })

  it('substitutes {query} placeholder in the configured endpoint URL', async () => {
    let capturedUrl: string | undefined
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      capturedUrl = url
      return Promise.resolve({
        ok: true,
        text: async () => '{"results": []}',
      })
    }))
    const tool = makeWebSearchTool({ endpoint: 'https://search.example.com?q={query}' })
    const r = await tool.run({ query: 'hello world' }, ctx)
    expect(r.isError).toBe(false)
    expect(capturedUrl).toBe('https://search.example.com?q=hello%20world')
  })

  it('injects auth header when apiKey is set', async () => {
    let capturedHeaders: Record<string, string> | undefined
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, opts: RequestInit) => {
      capturedHeaders = opts.headers as Record<string, string>
      return Promise.resolve({
        ok: true,
        text: async () => '[]',
      })
    }))
    const tool = makeWebSearchTool({
      endpoint: 'https://search.example.com?q={query}',
      apiKey: 'secret-key',
      authHeader: 'X-Api-Key',
      authPrefix: '',
    })
    await tool.run({ query: 'test' }, ctx)
    expect(capturedHeaders?.['X-Api-Key']).toBe('secret-key')
  })

  it('uses default Authorization header with Bearer prefix', async () => {
    let capturedHeaders: Record<string, string> | undefined
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, opts: RequestInit) => {
      capturedHeaders = opts.headers as Record<string, string>
      return Promise.resolve({
        ok: true,
        text: async () => '[]',
      })
    }))
    const tool = makeWebSearchTool({
      endpoint: 'https://search.example.com?q={query}',
      apiKey: 'mytoken',
    })
    await tool.run({ query: 'test' }, ctx)
    expect(capturedHeaders?.['Authorization']).toBe('Bearer mytoken')
  })

  it('returns error on non-200 response from configured endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    }))
    const tool = makeWebSearchTool({ endpoint: 'https://search.example.com?q={query}' })
    const r = await tool.run({ query: 'test' }, ctx)
    expect(r.isError).toBe(true)
    expect(r.output).toContain('503')
  })

  it('declares network permission', () => {
    const tool = makeWebSearchTool(undefined)
    expect(tool.needsPermission({ query: 'test' })).toBe('network')
  })
})
