import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import os from 'node:os'
import { fetchIndex, searchIndex, type MarketplaceIndex } from '../../../src/core/plugin/marketplaceIndex'
import { saveMarketplaces } from '../../../src/core/plugin/marketplace'

let home: string
let cachePath: string

const SAMPLE_INDEX: MarketplaceIndex = {
  plugins: [
    {
      name: 'my-tool',
      description: 'A useful tool',
      source: 'https://github.com/org/my-tool',
      keywords: ['utility', 'dev'],
    },
    {
      name: 'another-plugin',
      description: 'Another one',
      source: 'https://github.com/org/another',
      keywords: ['test'],
    },
  ],
}

beforeEach(async () => {
  home = await mkdtemp(join(os.tmpdir(), 'nuka-mp-idx-'))
  cachePath = join(home, '.nuka', 'cache', 'marketplace-index')
  await mkdir(cachePath, { recursive: true })
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(home, { recursive: true, force: true })
})

describe('fetchIndex', () => {
  it('fetches and caches on first call', async () => {
    const source = { type: 'url' as const, url: 'https://example.com/index.json' }

    // Mock global fetch
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(SAMPLE_INDEX),
    }))

    const index = await fetchIndex(source, cachePath)
    expect(index.plugins).toHaveLength(2)
    expect(vi.mocked(fetch)).toHaveBeenCalledOnce()

    // Cache file should exist
    const cacheFiles = await import('node:fs/promises').then(fs => fs.readdir(cachePath))
    expect(cacheFiles.length).toBeGreaterThan(0)
  })

  it('reads from cache on second call within refresh window', async () => {
    const source = { type: 'url' as const, url: 'https://example.com/index.json', refresh: '24h' }

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(SAMPLE_INDEX),
    })
    vi.stubGlobal('fetch', mockFetch)

    // First call fetches
    await fetchIndex(source, cachePath)
    expect(mockFetch).toHaveBeenCalledOnce()

    // Second call within window should NOT fetch again
    await fetchIndex(source, cachePath)
    expect(mockFetch).toHaveBeenCalledOnce()
  })

  it('re-fetches when cache is stale', async () => {
    const source = { type: 'url' as const, url: 'https://example.com/index.json', refresh: '1s' }

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(SAMPLE_INDEX),
    })
    vi.stubGlobal('fetch', mockFetch)

    // Seed a stale cache entry (fetchedAt 2 seconds ago)
    const staleEntry = {
      fetchedAt: Date.now() - 2000,
      index: SAMPLE_INDEX,
    }
    // Compute cache filename by calling through (it's internal, so we just seed any file)
    // We'll fetch once to prime the path, then manually overwrite
    await fetchIndex(source, cachePath)
    const cacheFiles = await import('node:fs/promises').then(fs => fs.readdir(cachePath))
    const cacheFile = join(cachePath, cacheFiles[0]!)
    await writeFile(cacheFile, JSON.stringify(staleEntry), 'utf8')

    mockFetch.mockClear()

    await fetchIndex(source, cachePath)
    expect(mockFetch).toHaveBeenCalledOnce()
  })

  it('falls back to stale cache when fetch fails', async () => {
    const source = { type: 'url' as const, url: 'https://example.com/index.json', refresh: '1s' }

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(SAMPLE_INDEX),
    })
    vi.stubGlobal('fetch', mockFetch)

    // Seed stale cache
    await fetchIndex(source, cachePath)
    const cacheFiles = await import('node:fs/promises').then(fs => fs.readdir(cachePath))
    const cacheFile = join(cachePath, cacheFiles[0]!)
    const cached = JSON.parse(await readFile(cacheFile, 'utf8')) as { fetchedAt: number; index: MarketplaceIndex }
    cached.fetchedAt = Date.now() - 2000
    await writeFile(cacheFile, JSON.stringify(cached), 'utf8')

    // Now make fetch fail
    mockFetch.mockRejectedValue(new Error('network error'))

    const index = await fetchIndex(source, cachePath)
    expect(index.plugins).toHaveLength(2)
  })

  it('throws when fetch fails and no cache exists', async () => {
    const source = { type: 'url' as const, url: 'https://example.com/index.json' }

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))

    await expect(fetchIndex(source, cachePath)).rejects.toThrow('network error')
  })

  it('throws for non-url sources', async () => {
    const source = { type: 'git' as const, git: 'https://github.com/org/repo' }
    await expect(fetchIndex(source, cachePath)).rejects.toThrow('only supports url sources')
  })
})

describe('searchIndex', () => {
  it('searches across multiple marketplaces and returns substring matches', async () => {
    await saveMarketplaces(home, {
      sources: {
        'market-a': { type: 'url', url: 'https://a.example.com/index.json' },
        'market-b': { type: 'url', url: 'https://b.example.com/index.json' },
      },
    })

    const indexA: MarketplaceIndex = {
      plugins: [
        { name: 'foo-tool', description: 'Foo does bar', source: 'https://github.com/foo/tool', keywords: ['foo'] },
      ],
    }
    const indexB: MarketplaceIndex = {
      plugins: [
        { name: 'bar-helper', description: 'Helps with foo things', source: 'https://github.com/bar/helper' },
        { name: 'unrelated', description: 'Completely different', source: 'https://github.com/x/y' },
      ],
    }

    vi.stubGlobal('fetch', vi.fn()
      .mockImplementationOnce(() => Promise.resolve({ ok: true, json: () => Promise.resolve(indexA) }))
      .mockImplementationOnce(() => Promise.resolve({ ok: true, json: () => Promise.resolve(indexB) })),
    )

    const results = await searchIndex(home, 'foo')
    expect(results).toHaveLength(2) // foo-tool from market-a, bar-helper from market-b (description mentions foo)
    const names = results.map(r => r.plugin.name)
    expect(names).toContain('foo-tool')
    expect(names).toContain('bar-helper')
    expect(names).not.toContain('unrelated')
  })

  it('returns marketplace name with each result', async () => {
    await saveMarketplaces(home, {
      sources: { 'my-market': { type: 'url', url: 'https://example.com/index.json' } },
    })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(SAMPLE_INDEX),
    }))

    const results = await searchIndex(home, 'tool')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]!.marketplace).toBe('my-market')
  })

  it('skips non-url marketplace sources', async () => {
    await saveMarketplaces(home, {
      sources: {
        'path-market': { type: 'path', path: '/local/plugins' },
      },
    })

    const results = await searchIndex(home, 'anything')
    expect(results).toHaveLength(0)
  })
})
