import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import os from 'node:os'
import {
  readOptions,
  writeUserValues,
  writeMarketplaceDefaults,
  effectiveValues,
  type PluginOptions,
} from '../../../src/core/plugin/optionsStorage'

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(os.tmpdir(), 'nuka-opts-'))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function pluginDir(name: string): Promise<string> {
  const dir = join(home, '.nuka', 'plugins', name)
  await mkdir(dir, { recursive: true })
  return dir
}

// ---------------------------------------------------------------------------
// readOptions
// ---------------------------------------------------------------------------

describe('readOptions', () => {
  it('returns empty userValues and defaults when no files exist (spec acc. 1)', async () => {
    const opts = await readOptions(home, 'my-plugin', { timeout: 30 })
    // Spec acceptance 1: no .userconfig.json → effective = defaults ∪ marketplaceDefaults
    expect(opts.userValues).toEqual({})
    expect(opts.defaults).toEqual({ timeout: 30 })
    expect(opts.marketplaceDefaults).toBeUndefined()
    const eff = effectiveValues(opts)
    expect(eff).toEqual({ timeout: 30 })
  })

  it('reads existing userValues from .userconfig.json', async () => {
    const dir = await pluginDir('my-plugin')
    await writeFile(join(dir, '.userconfig.json'), JSON.stringify({ token: 'abc' }), 'utf8')
    const opts = await readOptions(home, 'my-plugin')
    expect(opts.userValues).toEqual({ token: 'abc' })
  })

  it('reads marketplaceDefaults from .marketplace-defaults.json', async () => {
    const dir = await pluginDir('my-plugin')
    await writeFile(
      join(dir, '.marketplace-defaults.json'),
      JSON.stringify({ endpoint: 'https://api.example.com' }),
      'utf8',
    )
    const opts = await readOptions(home, 'my-plugin')
    expect(opts.marketplaceDefaults).toEqual({ endpoint: 'https://api.example.com' })
  })

  it('uses empty defaults object when not provided', async () => {
    const opts = await readOptions(home, 'my-plugin')
    expect(opts.defaults).toEqual({})
  })

  it('handles invalid JSON in userconfig gracefully', async () => {
    const dir = await pluginDir('my-plugin')
    await writeFile(join(dir, '.userconfig.json'), '{ bad json }', 'utf8')
    const opts = await readOptions(home, 'my-plugin')
    expect(opts.userValues).toEqual({})
  })

  it('handles invalid JSON in marketplace-defaults gracefully', async () => {
    const dir = await pluginDir('my-plugin')
    await writeFile(join(dir, '.marketplace-defaults.json'), 'not json', 'utf8')
    const opts = await readOptions(home, 'my-plugin')
    expect(opts.marketplaceDefaults).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// writeUserValues
// ---------------------------------------------------------------------------

describe('writeUserValues', () => {
  it('writes values to .userconfig.json (spec acc. 2)', async () => {
    await writeUserValues(home, 'my-plugin', { token: 'x' })
    const opts = await readOptions(home, 'my-plugin')
    // Spec acceptance 2: user writes {token:'x'} → effective.token === 'x'
    const eff = effectiveValues(opts)
    expect(eff['token']).toBe('x')
  })

  it('creates plugin directory if it does not exist', async () => {
    await writeUserValues(home, 'brand-new', { key: 'val' })
    const opts = await readOptions(home, 'brand-new')
    expect(opts.userValues['key']).toBe('val')
  })

  it('merges with existing values (partial update)', async () => {
    await writeUserValues(home, 'my-plugin', { a: 1, b: 2 })
    await writeUserValues(home, 'my-plugin', { b: 99, c: 3 })
    const opts = await readOptions(home, 'my-plugin')
    expect(opts.userValues).toEqual({ a: 1, b: 99, c: 3 })
  })

  it('persists data as valid JSON', async () => {
    await writeUserValues(home, 'my-plugin', { x: 42 })
    const dir = join(home, '.nuka', 'plugins', 'my-plugin')
    const raw = await readFile(join(dir, '.userconfig.json'), 'utf8')
    expect(JSON.parse(raw)).toEqual({ x: 42 })
  })
})

// ---------------------------------------------------------------------------
// writeMarketplaceDefaults
// ---------------------------------------------------------------------------

describe('writeMarketplaceDefaults', () => {
  it('writes marketplace defaults to .marketplace-defaults.json', async () => {
    await writeMarketplaceDefaults(home, 'my-plugin', { endpoint: 'https://x.com' })
    const opts = await readOptions(home, 'my-plugin')
    expect(opts.marketplaceDefaults).toEqual({ endpoint: 'https://x.com' })
  })
})

// ---------------------------------------------------------------------------
// effectiveValues — merge order: defaults < marketplaceDefaults < userValues
// ---------------------------------------------------------------------------

describe('effectiveValues', () => {
  it('returns defaults when no other layers set', () => {
    const opts: PluginOptions = {
      defaults: { timeout: 30, debug: false },
      userValues: {},
    }
    expect(effectiveValues(opts)).toEqual({ timeout: 30, debug: false })
  })

  it('marketplaceDefaults overrides defaults', () => {
    const opts: PluginOptions = {
      defaults: { timeout: 30 },
      userValues: {},
      marketplaceDefaults: { timeout: 60 },
    }
    expect(effectiveValues(opts)['timeout']).toBe(60)
  })

  it('userValues overrides marketplaceDefaults and defaults', () => {
    const opts: PluginOptions = {
      defaults: { timeout: 30, debug: false },
      userValues: { timeout: 120 },
      marketplaceDefaults: { timeout: 60, extra: 'val' },
    }
    const eff = effectiveValues(opts)
    expect(eff['timeout']).toBe(120)
    expect(eff['extra']).toBe('val')
    expect(eff['debug']).toBe(false)
  })

  it('userValues only overrides what is specified', () => {
    const opts: PluginOptions = {
      defaults: { a: 1, b: 2 },
      userValues: { a: 99 },
    }
    const eff = effectiveValues(opts)
    expect(eff['a']).toBe(99)
    expect(eff['b']).toBe(2)
  })

  it('empty userValues → effective = defaults ∪ marketplaceDefaults (spec acc. 1)', () => {
    const opts: PluginOptions = {
      defaults: { timeout: 30 },
      userValues: {},
      marketplaceDefaults: { endpoint: 'https://api.example.com' },
    }
    const eff = effectiveValues(opts)
    expect(eff).toEqual({ timeout: 30, endpoint: 'https://api.example.com' })
  })

  it('full merge: all three layers', async () => {
    await writeMarketplaceDefaults(home, 'p', { a: 'mkt', b: 'mkt' })
    await writeUserValues(home, 'p', { b: 'user' })
    const opts = await readOptions(home, 'p', { a: 'def', c: 'def' })
    const eff = effectiveValues(opts)
    expect(eff['a']).toBe('mkt')  // defaults overridden by marketplace
    expect(eff['b']).toBe('user') // marketplace overridden by user
    expect(eff['c']).toBe('def')  // default not overridden
  })
})
