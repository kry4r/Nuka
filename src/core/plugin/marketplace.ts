import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'

export type MarketplaceSource =
  | { type: 'url'; url: string; refresh?: string }
  | { type: 'git'; git: string; branch?: string }
  | { type: 'path'; path: string }

export type MarketplacesConfig = { sources: Record<string, MarketplaceSource> }

function marketplacesPath(home: string): string {
  return join(home, '.nuka', 'marketplaces.json')
}

export async function loadMarketplaces(home: string): Promise<MarketplacesConfig> {
  try {
    const raw = await readFile(marketplacesPath(home), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'sources' in parsed &&
      typeof (parsed as Record<string, unknown>).sources === 'object'
    ) {
      return parsed as MarketplacesConfig
    }
    return { sources: {} }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { sources: {} }
    }
    throw err
  }
}

export async function saveMarketplaces(home: string, cfg: MarketplacesConfig): Promise<void> {
  const filePath = marketplacesPath(home)
  const dir = join(home, '.nuka')
  await mkdir(dir, { recursive: true })
  // Atomic write: write to tmp file then rename
  const tmpPath = join(tmpdir(), `nuka-marketplaces-${randomBytes(8).toString('hex')}.json`)
  await writeFile(tmpPath, JSON.stringify(cfg, null, 2), 'utf8')
  await rename(tmpPath, filePath)
}

export async function addMarketplace(
  home: string,
  name: string,
  source: MarketplaceSource,
): Promise<void> {
  const cfg = await loadMarketplaces(home)
  cfg.sources[name] = source
  await saveMarketplaces(home, cfg)
}

export async function removeMarketplace(home: string, name: string): Promise<void> {
  const cfg = await loadMarketplaces(home)
  delete cfg.sources[name]
  await saveMarketplaces(home, cfg)
}
