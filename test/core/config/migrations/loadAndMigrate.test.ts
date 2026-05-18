import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import { parse as parseYaml } from 'yaml'
import { loadAndMigrate } from '../../../../src/core/config/migrations/loadAndMigrate'
import type { Migration } from '../../../../src/core/config/migrations/types'

function tmpHome(): string {
  return mkdtempSync(join(os.tmpdir(), 'nuka-loadmig-'))
}

function seed(home: string, yamlText: string): string {
  mkdirSync(join(home, '.nuka'), { recursive: true })
  const p = join(home, '.nuka', 'config.yaml')
  writeFileSync(p, yamlText, { encoding: 'utf8' })
  return p
}

describe('loadAndMigrate', () => {
  it('ENOENT — returns empty config, no write, no migration ran', async () => {
    const home = tmpHome()
    const result = await loadAndMigrate(home)
    expect(result.raw).toEqual({})
    expect(result.wroteBack).toBe(false)
    expect(result.ranFrom).toBe(1)
    expect(result.ranTo).toBe(1)
    expect(existsSync(join(home, '.nuka', 'config.yaml'))).toBe(false)
  })

  it('absent version is treated as v1 and migrated to current', async () => {
    const home = tmpHome()
    const path = seed(home, 'providers: []\n')
    const result = await loadAndMigrate(home)
    expect(result.ranFrom).toBe(1)
    expect(result.ranTo).toBeGreaterThanOrEqual(2)
    expect(result.wroteBack).toBe(true)
    const onDisk = parseYaml(readFileSync(path, 'utf8'))
    expect(onDisk.version).toBe(result.ranTo)
    expect(onDisk.providers).toEqual([])
  })

  it('explicit version: 1 round-trips to v2 with on-disk bump', async () => {
    const home = tmpHome()
    const path = seed(home, 'version: 1\nproviders: []\n')
    const result = await loadAndMigrate(home)
    expect(result.ranFrom).toBe(1)
    expect(result.ranTo).toBe(2)
    expect(result.wroteBack).toBe(true)
    const onDisk = parseYaml(readFileSync(path, 'utf8'))
    expect(onDisk.version).toBe(2)
  })

  it('already-current version is a no-op (no write)', async () => {
    const home = tmpHome()
    const path = seed(home, 'version: 2\nproviders: []\n')
    const before = readFileSync(path, 'utf8')
    const result = await loadAndMigrate(home)
    expect(result.wroteBack).toBe(false)
    expect(result.ranFrom).toBe(2)
    expect(result.ranTo).toBe(2)
    const after = readFileSync(path, 'utf8')
    expect(after).toBe(before) // byte-identical
  })

  it('broken migration rolls back — on-disk file unchanged', async () => {
    const home = tmpHome()
    const path = seed(home, 'version: 1\nproviders: []\nmarker: keep-me\n')
    const before = readFileSync(path, 'utf8')
    const bad: Migration = {
      from: 1, to: 2,
      migrate: () => { throw new Error('intentional fail') },
    }
    await expect(loadAndMigrate(home, { registry: [bad] })).rejects.toThrow(/intentional fail/)
    const after = readFileSync(path, 'utf8')
    expect(after).toBe(before)
    expect(existsSync(path + '.tmp')).toBe(false)
  })

  it('an empty YAML document is treated as {}', async () => {
    const home = tmpHome()
    const path = seed(home, '')
    const result = await loadAndMigrate(home)
    expect(result.ranFrom).toBe(1)
    expect(result.wroteBack).toBe(true)
    const onDisk = parseYaml(readFileSync(path, 'utf8'))
    expect(onDisk.version).toBeGreaterThanOrEqual(2)
  })

  it('a non-object YAML root (a bare string/list) is rejected without writing', async () => {
    const home = tmpHome()
    const path = seed(home, '- not-an-object\n')
    const before = readFileSync(path, 'utf8')
    await expect(loadAndMigrate(home)).rejects.toThrow()
    expect(readFileSync(path, 'utf8')).toBe(before)
  })
})
