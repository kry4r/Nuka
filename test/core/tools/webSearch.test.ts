import { describe, it, expect, vi, afterEach } from 'vitest'
import { makeWebSearchTool } from '../../../src/core/tools/webSearch'

const ctx = { signal: new AbortController().signal, cwd: process.cwd() }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('makeWebSearchTool', () => {
  it('returns not-configured error when cfg is undefined', async () => {
    const tool = makeWebSearchTool(undefined)
    const r = await tool.run({ query: 'hello' }, ctx)
    expect(r.isError).toBe(true)
    expect(r.output).toContain('not configured')
  })

  it('substitutes {query} placeholder in the endpoint URL', async () => {
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

  it('returns error on non-200 response', async () => {
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
