import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import os from 'node:os'
import {
  loadMarketplaces,
  saveMarketplaces,
  addMarketplace,
  removeMarketplace,
  type MarketplaceSource,
} from '../../../src/core/plugin/marketplace'

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(os.tmpdir(), 'nuka-mp-'))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

describe('loadMarketplaces', () => {
  it('returns empty config when file is absent', async () => {
    const cfg = await loadMarketplaces(home)
    expect(cfg).toEqual({ sources: {} })
  })

  it('loads saved config correctly', async () => {
    const source: MarketplaceSource = { type: 'url', url: 'https://example.com/index.json' }
    await saveMarketplaces(home, { sources: { official: source } })
    const cfg = await loadMarketplaces(home)
    expect(cfg.sources['official']).toEqual(source)
  })
})

describe('saveMarketplaces', () => {
  it('round-trips all source types', async () => {
    const cfg = {
      sources: {
        byUrl: { type: 'url' as const, url: 'https://example.com/idx.json', refresh: '12h' },
        byGit: { type: 'git' as const, git: 'https://github.com/org/plugins', branch: 'main' },
        byPath: { type: 'path' as const, path: '/local/plugins' },
      },
    }
    await saveMarketplaces(home, cfg)
    const loaded = await loadMarketplaces(home)
    expect(loaded).toEqual(cfg)
  })
})

describe('addMarketplace', () => {
  it('adds a source that is then loadable', async () => {
    const source: MarketplaceSource = { type: 'url', url: 'https://example.com/index.json' }
    await addMarketplace(home, 'my-market', source)
    const cfg = await loadMarketplaces(home)
    expect(cfg.sources['my-market']).toEqual(source)
  })

  it('does not corrupt config when called twice sequentially', async () => {
    await addMarketplace(home, 'market-a', { type: 'url', url: 'https://a.example.com/' })
    await addMarketplace(home, 'market-b', { type: 'url', url: 'https://b.example.com/' })
    const cfg = await loadMarketplaces(home)
    expect(Object.keys(cfg.sources)).toContain('market-a')
    expect(Object.keys(cfg.sources)).toContain('market-b')
  })

  it('two concurrent addMarketplace calls do not corrupt the file', async () => {
    // Run both concurrently — last write wins but file must remain valid JSON
    await Promise.all([
      addMarketplace(home, 'concurrent-a', { type: 'url', url: 'https://ca.example.com/' }),
      addMarketplace(home, 'concurrent-b', { type: 'url', url: 'https://cb.example.com/' }),
    ])
    // File must parse without error
    const cfg = await loadMarketplaces(home)
    expect(cfg.sources).toBeDefined()
    expect(typeof cfg.sources).toBe('object')
  })
})

describe('removeMarketplace', () => {
  it('removes an existing source', async () => {
    await addMarketplace(home, 'to-remove', { type: 'url', url: 'https://example.com/' })
    await removeMarketplace(home, 'to-remove')
    const cfg = await loadMarketplaces(home)
    expect(cfg.sources['to-remove']).toBeUndefined()
  })

  it('is a no-op when source does not exist', async () => {
    // Should not throw
    await expect(removeMarketplace(home, 'nonexistent')).resolves.toBeUndefined()
  })
})
