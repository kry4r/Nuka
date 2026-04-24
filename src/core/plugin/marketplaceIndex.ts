import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadMarketplaces, type MarketplaceSource } from './marketplace'

export type MarketplaceIndex = {
  plugins: Array<{
    name: string
    description?: string
    source: string
    version?: string
    keywords?: string[]
    license?: string
  }>
}

/**
 * Parse a refresh duration string like "24h", "30m", "60s" into milliseconds.
 * Defaults to 24h if the string is absent or unparseable.
 */
function parseRefreshMs(refresh: string | undefined): number {
  if (!refresh) return 24 * 60 * 60 * 1000
  const match = /^(\d+)(h|m|s)$/.exec(refresh)
  if (!match) return 24 * 60 * 60 * 1000
  const value = parseInt(match[1]!, 10)
  switch (match[2]) {
    case 'h':
      return value * 60 * 60 * 1000
    case 'm':
      return value * 60 * 1000
    case 's':
      return value * 1000
    default:
      return 24 * 60 * 60 * 1000
  }
}

/**
 * Fetch a URL and return parsed JSON, or null on failure.
 */
async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`)
  }
  return res.json() as Promise<unknown>
}

function cachePathForSource(cachePath: string, source: MarketplaceSource): string {
  // Use a safe filename derived from the source identifier
  let id: string
  if (source.type === 'url') {
    id = Buffer.from(source.url).toString('base64url').slice(0, 64)
  } else if (source.type === 'git') {
    id = Buffer.from(source.git).toString('base64url').slice(0, 64)
  } else {
    id = Buffer.from(source.path).toString('base64url').slice(0, 64)
  }
  return join(cachePath, `index-${id}.json`)
}

interface CacheEntry {
  fetchedAt: number
  index: MarketplaceIndex
}

export async function fetchIndex(
  source: MarketplaceSource,
  cachePath: string,
): Promise<MarketplaceIndex> {
  await mkdir(cachePath, { recursive: true })
  const cacheFile = cachePathForSource(cachePath, source)

  // Only URL sources can be fetched; git/path sources are not fetched over HTTP
  if (source.type !== 'url') {
    throw new Error(`fetchIndex only supports url sources, got: ${source.type}`)
  }

  const refreshMs = parseRefreshMs(source.refresh)

  // Check cache freshness
  let cachedEntry: CacheEntry | null = null
  try {
    const raw = await readFile(cacheFile, 'utf8')
    cachedEntry = JSON.parse(raw) as CacheEntry
  } catch {
    // Cache miss or corrupt — will fetch
  }

  if (cachedEntry !== null) {
    const age = Date.now() - cachedEntry.fetchedAt
    if (age < refreshMs) {
      return cachedEntry.index
    }
  }

  // Attempt network fetch
  let index: MarketplaceIndex | null = null
  try {
    const data = await fetchJson(source.url)
    if (
      data !== null &&
      typeof data === 'object' &&
      'plugins' in data &&
      Array.isArray((data as Record<string, unknown>).plugins)
    ) {
      index = data as MarketplaceIndex
    } else {
      throw new Error('invalid index format: missing plugins array')
    }
  } catch (err) {
    // Network failure — fall back to stale cache if any
    if (cachedEntry !== null) {
      return cachedEntry.index
    }
    throw err
  }

  // Write fresh cache
  const entry: CacheEntry = { fetchedAt: Date.now(), index }
  await writeFile(cacheFile, JSON.stringify(entry, null, 2), 'utf8')

  return index
}

export async function searchIndex(
  home: string,
  query: string,
): Promise<Array<{ marketplace: string; plugin: MarketplaceIndex['plugins'][number] }>> {
  const cfg = await loadMarketplaces(home)
  const cachePath = join(home, '.nuka', 'cache', 'marketplace-index')
  const lowerQuery = query.toLowerCase()

  const results: Array<{ marketplace: string; plugin: MarketplaceIndex['plugins'][number] }> = []

  for (const [name, source] of Object.entries(cfg.sources)) {
    if (source.type !== 'url') continue
    let index: MarketplaceIndex
    try {
      index = await fetchIndex(source, cachePath)
    } catch {
      // Skip unreachable marketplaces during search
      continue
    }

    for (const plugin of index.plugins) {
      const searchTargets = [
        plugin.name,
        plugin.description ?? '',
        ...(plugin.keywords ?? []),
      ]
        .join(' ')
        .toLowerCase()

      if (searchTargets.includes(lowerQuery)) {
        results.push({ marketplace: name, plugin })
      }
    }
  }

  return results
}
