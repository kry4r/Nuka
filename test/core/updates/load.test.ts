// test/core/updates/load.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { loadUpdates, MAX_ENTRIES, MAX_BULLETS, MAX_BULLET_LEN } from '../../../src/core/updates/load'

async function withTmp(fn: (home: string) => Promise<void>): Promise<void> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'nuka-updates-test-'))
  try {
    await fn(home)
  } finally {
    await fs.rm(home, { recursive: true, force: true })
  }
}

async function writeUpdates(home: string, data: unknown): Promise<void> {
  const dir = path.join(home, '.nuka')
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'updates.json'), JSON.stringify(data), 'utf8')
}

describe('loadUpdates', () => {
  it('returns [] when file does not exist', async () => {
    await withTmp(async home => {
      const result = await loadUpdates(home)
      expect(result).toEqual([])
    })
  })

  it('returns [] when file contains invalid JSON', async () => {
    await withTmp(async home => {
      const dir = path.join(home, '.nuka')
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(path.join(dir, 'updates.json'), 'not-json', 'utf8')
      const result = await loadUpdates(home)
      expect(result).toEqual([])
    })
  })

  it('returns [] when root is a plain string', async () => {
    await withTmp(async home => {
      await writeUpdates(home, 'hello')
      const result = await loadUpdates(home)
      expect(result).toEqual([])
    })
  })

  it('parses a top-level array of entries', async () => {
    await withTmp(async home => {
      await writeUpdates(home, [
        { version: '1.0.0', date: '2026-04-01', title: 'Initial release', bullets: ['First bullet'] },
      ])
      const result = await loadUpdates(home)
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({ version: '1.0.0', title: 'Initial release' })
      expect(result[0]?.bullets).toEqual(['First bullet'])
    })
  })

  it('parses { entries: [...] } shape', async () => {
    await withTmp(async home => {
      await writeUpdates(home, { entries: [{ title: 'v2', bullets: ['Bug fix'] }] })
      const result = await loadUpdates(home)
      expect(result).toHaveLength(1)
      expect(result[0]?.title).toBe('v2')
    })
  })

  it(`caps at ${MAX_ENTRIES} entries`, async () => {
    await withTmp(async home => {
      const data = Array.from({ length: MAX_ENTRIES + 3 }, (_, i) => ({ title: `v${i}` }))
      await writeUpdates(home, data)
      const result = await loadUpdates(home)
      expect(result).toHaveLength(MAX_ENTRIES)
    })
  })

  it(`caps bullets at ${MAX_BULLETS} per entry`, async () => {
    await withTmp(async home => {
      const bullets = Array.from({ length: MAX_BULLETS + 5 }, (_, i) => `bullet ${i}`)
      await writeUpdates(home, [{ title: 'release', bullets }])
      const result = await loadUpdates(home)
      expect(result[0]?.bullets).toHaveLength(MAX_BULLETS)
    })
  })

  it(`truncates long bullets to ${MAX_BULLET_LEN} chars with ellipsis`, async () => {
    await withTmp(async home => {
      const longBullet = 'x'.repeat(MAX_BULLET_LEN + 10)
      await writeUpdates(home, [{ title: 'release', bullets: [longBullet] }])
      const result = await loadUpdates(home)
      const bullet = result[0]?.bullets?.[0] ?? ''
      expect(bullet.length).toBe(MAX_BULLET_LEN)
      expect(bullet.endsWith('\u2026')).toBe(true)
    })
  })

  it('ignores non-string bullets', async () => {
    await withTmp(async home => {
      await writeUpdates(home, [{ title: 'v1', bullets: [42, 'good', null, 'also good'] }])
      const result = await loadUpdates(home)
      expect(result[0]?.bullets).toEqual(['good', 'also good'])
    })
  })

  it('skips non-object entries gracefully', async () => {
    await withTmp(async home => {
      await writeUpdates(home, ['string-entry', { title: 'ok' }, null])
      const result = await loadUpdates(home)
      // string-entry and null become empty objects
      expect(result).toHaveLength(3)
      expect(result[1]).toMatchObject({ title: 'ok' })
    })
  })

  it('returns [] when entries field is not an array', async () => {
    await withTmp(async home => {
      await writeUpdates(home, { entries: 'not an array' })
      const result = await loadUpdates(home)
      expect(result).toEqual([])
    })
  })
})
