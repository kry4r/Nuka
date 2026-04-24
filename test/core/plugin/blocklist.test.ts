import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import os from 'node:os'
import {
  fetchBlocklist,
  detectDelisted,
  type Blocklist,
} from '../../../src/core/plugin/blocklist'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(join(os.tmpdir(), 'nuka-bl-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBlocklist(blocked: Blocklist['blocked']): Blocklist {
  return { blocked }
}

/** Create a mock fetch that returns the given JSON body */
function mockFetch(body: unknown, ok = true): typeof fetch {
  return async (_url: string | URL | Request) => {
    return {
      ok,
      status: ok ? 200 : 500,
      text: async () => JSON.stringify(body),
    } as Response
  }
}

// ---------------------------------------------------------------------------
// fetchBlocklist
// ---------------------------------------------------------------------------

describe('fetchBlocklist', () => {
  it('fetches and parses a valid blocklist', async () => {
    const cachePath = join(tmpDir, 'blocklist.json')
    const body = { blocked: [{ name: 'bad-plugin', reason: 'malware' }] }
    const bl = await fetchBlocklist('http://example.com/bl.json', cachePath, mockFetch(body))
    expect(bl.blocked).toHaveLength(1)
    expect(bl.blocked[0]!.name).toBe('bad-plugin')
    expect(bl.blocked[0]!.reason).toBe('malware')
  })

  it('writes the result to cache', async () => {
    const cachePath = join(tmpDir, 'sub', 'bl.json')
    const body = { blocked: [{ name: 'foo' }] }
    await fetchBlocklist('http://x.com/bl', cachePath, mockFetch(body))
    const cached = JSON.parse(await readFile(cachePath, 'utf8'))
    expect(cached.blocked[0].name).toBe('foo')
  })

  it('falls back to cache when fetch fails', async () => {
    const cachePath = join(tmpDir, 'bl.json')
    // Pre-populate cache
    const { writeFile, mkdir } = await import('node:fs/promises')
    const { dirname } = await import('node:path')
    await mkdir(dirname(cachePath), { recursive: true })
    await writeFile(cachePath, JSON.stringify({ blocked: [{ name: 'cached-plugin' }] }), 'utf8')

    const failFetch: typeof fetch = async () => {
      throw new Error('network down')
    }
    const bl = await fetchBlocklist('http://x.com/bl', cachePath, failFetch)
    expect(bl.blocked[0]!.name).toBe('cached-plugin')
  })

  it('throws when fetch fails and no cache', async () => {
    const cachePath = join(tmpDir, 'missing.json')
    const failFetch: typeof fetch = async () => { throw new Error('offline') }
    await expect(fetchBlocklist('http://x.com/bl', cachePath, failFetch)).rejects.toThrow()
  })

  it('throws on HTTP error status with no cache', async () => {
    const cachePath = join(tmpDir, 'nofile.json')
    await expect(
      fetchBlocklist('http://x.com/bl', cachePath, mockFetch({}, false)),
    ).rejects.toThrow('HTTP 500')
  })

  it('throws on invalid JSON body', async () => {
    const cachePath = join(tmpDir, 'inv.json')
    const badFetch: typeof fetch = async () =>
      ({ ok: true, status: 200, text: async () => 'not json' }) as Response
    await expect(fetchBlocklist('http://x.com/bl', cachePath, badFetch)).rejects.toThrow()
  })

  it('throws when body has no blocked array', async () => {
    const cachePath = join(tmpDir, 'inv2.json')
    await expect(
      fetchBlocklist('http://x.com/bl', cachePath, mockFetch({ something: [] })),
    ).rejects.toThrow('invalid format')
  })

  it('filters out entries without a name', async () => {
    const cachePath = join(tmpDir, 'bl.json')
    const body = { blocked: [{ name: 'good' }, { noName: true }, null] }
    const bl = await fetchBlocklist('http://x.com/bl', cachePath, mockFetch(body))
    expect(bl.blocked).toHaveLength(1)
    expect(bl.blocked[0]!.name).toBe('good')
  })
})

// ---------------------------------------------------------------------------
// detectDelisted
// ---------------------------------------------------------------------------

describe('detectDelisted', () => {
  it('returns empty array when nothing is blocked', () => {
    const installed = [{ name: 'foo', version: '1.0' }]
    const bl = makeBlocklist([])
    expect(detectDelisted(installed, bl)).toEqual([])
  })

  it('returns delisted plugin when no sinceVersion is specified (case 1 of spec)', () => {
    const installed = [{ name: 'foo', version: '1.0' }]
    const bl = makeBlocklist([{ name: 'foo' }])
    const result = detectDelisted(installed, bl)
    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe('foo')
  })

  it('returns delisted with reason from blocklist', () => {
    const installed = [{ name: 'foo', version: '1.0' }]
    const bl = makeBlocklist([{ name: 'foo', reason: 'security vulnerability' }])
    const result = detectDelisted(installed, bl)
    expect(result[0]!.reason).toBe('security vulnerability')
  })

  it('uses default reason when blocklist entry has no reason', () => {
    const installed = [{ name: 'foo', version: '1.0' }]
    const bl = makeBlocklist([{ name: 'foo' }])
    const result = detectDelisted(installed, bl)
    expect(result[0]!.reason).toBeTruthy()
  })

  it('does NOT delist when installed version < sinceVersion (case 2 of spec)', () => {
    // foo@1.0, sinceVersion=2.0 → NOT delisted
    const installed = [{ name: 'foo', version: '1.0' }]
    const bl = makeBlocklist([{ name: 'foo', sinceVersion: '2.0' }])
    const result = detectDelisted(installed, bl)
    expect(result).toHaveLength(0)
  })

  it('delists when installed version === sinceVersion', () => {
    const installed = [{ name: 'foo', version: '2.0' }]
    const bl = makeBlocklist([{ name: 'foo', sinceVersion: '2.0' }])
    const result = detectDelisted(installed, bl)
    expect(result).toHaveLength(1)
  })

  it('delists when installed version > sinceVersion', () => {
    const installed = [{ name: 'foo', version: '3.1' }]
    const bl = makeBlocklist([{ name: 'foo', sinceVersion: '2.0' }])
    const result = detectDelisted(installed, bl)
    expect(result).toHaveLength(1)
  })

  it('handles multi-segment versions correctly', () => {
    // 1.9.99 < 2.0.0 → NOT delisted
    const installed = [{ name: 'foo', version: '1.9.99' }]
    const bl = makeBlocklist([{ name: 'foo', sinceVersion: '2.0.0' }])
    expect(detectDelisted(installed, bl)).toHaveLength(0)

    // 2.0.1 > 2.0.0 → delisted
    const installed2 = [{ name: 'foo', version: '2.0.1' }]
    expect(detectDelisted(installed2, bl)).toHaveLength(1)
  })

  it('is conservative with non-numeric segments (delists)', () => {
    // "1.0-alpha" has a non-numeric segment → be conservative → delist
    const installed = [{ name: 'foo', version: '1.0-alpha' }]
    const bl = makeBlocklist([{ name: 'foo', sinceVersion: '2.0' }])
    const result = detectDelisted(installed, bl)
    expect(result).toHaveLength(1)
  })

  it('is conservative when sinceVersion has non-numeric segment', () => {
    const installed = [{ name: 'foo', version: '1.0' }]
    const bl = makeBlocklist([{ name: 'foo', sinceVersion: '2.0-beta' }])
    const result = detectDelisted(installed, bl)
    expect(result).toHaveLength(1)
  })

  it('does not delist plugins not in blocklist', () => {
    const installed = [
      { name: 'safe', version: '1.0' },
      { name: 'bad', version: '1.0' },
    ]
    const bl = makeBlocklist([{ name: 'bad' }])
    const result = detectDelisted(installed, bl)
    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe('bad')
  })

  it('handles empty installed list', () => {
    const bl = makeBlocklist([{ name: 'foo' }])
    expect(detectDelisted([], bl)).toEqual([])
  })

  it('handles multiple blocked plugins', () => {
    const installed = [
      { name: 'a', version: '1.0' },
      { name: 'b', version: '2.0' },
      { name: 'c', version: '3.0' },
    ]
    const bl = makeBlocklist([{ name: 'a' }, { name: 'c', reason: 'spyware' }])
    const result = detectDelisted(installed, bl)
    expect(result.map(r => r.name).sort()).toEqual(['a', 'c'])
  })
})
