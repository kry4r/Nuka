import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import os from 'node:os'
import {
  getUserConfigPath,
  readUserConfig,
  writeUserConfig,
  needsUserConfigPrompt,
} from '../../../src/core/plugin/userConfig'
import type { LoadedPlugin } from '../../../src/core/plugin/manifest'

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(os.tmpdir(), 'nuka-ucfg-'))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

function makePlugin(userConfigFields?: LoadedPlugin['manifest']['userConfig']): LoadedPlugin {
  return {
    manifest: {
      name: 'my-plugin',
      tools: [],
      slashCommands: [],
      skills: [],
      mcpServers: {},
      userConfig: userConfigFields,
    },
    rootDir: join(home, '.nuka', 'plugins', 'my-plugin'),
    source: 'installed',
  }
}

describe('getUserConfigPath', () => {
  it('returns correct path', () => {
    const p = getUserConfigPath('/home/user', 'my-plugin')
    expect(p).toBe('/home/user/.nuka/plugins/my-plugin/.userconfig.json')
  })
})

describe('readUserConfig', () => {
  it('returns null when file does not exist', async () => {
    const result = await readUserConfig(home, 'my-plugin')
    expect(result).toBeNull()
  })

  it('reads and parses a valid config file', async () => {
    const dir = join(home, '.nuka', 'plugins', 'my-plugin')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, '.userconfig.json'), JSON.stringify({ token: 'abc123' }), 'utf8')
    const result = await readUserConfig(home, 'my-plugin')
    expect(result).toEqual({ token: 'abc123' })
  })

  it('returns null for malformed JSON', async () => {
    const dir = join(home, '.nuka', 'plugins', 'my-plugin')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, '.userconfig.json'), '{ bad json }', 'utf8')
    const result = await readUserConfig(home, 'my-plugin')
    expect(result).toBeNull()
  })

  it('returns null when value is an array (not an object)', async () => {
    const dir = join(home, '.nuka', 'plugins', 'my-plugin')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, '.userconfig.json'), JSON.stringify([1, 2, 3]), 'utf8')
    const result = await readUserConfig(home, 'my-plugin')
    expect(result).toBeNull()
  })
})

describe('writeUserConfig', () => {
  it('creates the config file with correct content', async () => {
    const config = { token: 'secret', count: 42 }
    await writeUserConfig(home, 'my-plugin', config)
    const raw = await readFile(getUserConfigPath(home, 'my-plugin'), 'utf8')
    expect(JSON.parse(raw)).toEqual(config)
  })

  it('creates parent directory if it does not exist', async () => {
    await writeUserConfig(home, 'brand-new-plugin', { key: 'value' })
    const raw = await readFile(getUserConfigPath(home, 'brand-new-plugin'), 'utf8')
    expect(JSON.parse(raw)).toEqual({ key: 'value' })
  })

  it('overwrites existing config', async () => {
    await writeUserConfig(home, 'my-plugin', { old: true })
    await writeUserConfig(home, 'my-plugin', { new: true })
    const result = await readUserConfig(home, 'my-plugin')
    expect(result).toEqual({ new: true })
  })
})

describe('needsUserConfigPrompt', () => {
  it('returns false when plugin has no userConfig', async () => {
    const plugin = makePlugin(undefined)
    expect(await needsUserConfigPrompt(plugin, home)).toBe(false)
  })

  it('returns false when plugin has empty fields array', async () => {
    const plugin = makePlugin({ fields: [] })
    expect(await needsUserConfigPrompt(plugin, home)).toBe(false)
  })

  it('returns true when plugin has fields and no .userconfig.json', async () => {
    const plugin = makePlugin({ fields: [{ name: 'token', type: 'string' }] })
    expect(await needsUserConfigPrompt(plugin, home)).toBe(true)
  })

  it('returns false when .userconfig.json exists', async () => {
    const plugin = makePlugin({ fields: [{ name: 'token', type: 'string' }] })
    await writeUserConfig(home, 'my-plugin', { token: 'exists' })
    expect(await needsUserConfigPrompt(plugin, home)).toBe(false)
  })
})
