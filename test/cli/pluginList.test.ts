import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import os from 'node:os'
import { loadPlugins } from '../../src/core/plugin/loader'

// Integration-style tests for the plugin list data path.
// CLI output tests live in e2e but the data layer is tested here.

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(os.tmpdir(), 'nuka-plist-'))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

async function makePlugin(name: string, yaml: string): Promise<void> {
  const dir = join(home, '.nuka', 'plugins', name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'plugin.json'), JSON.stringify({ name, ...JSON.parse(yaml) }), 'utf8')
}

async function makePluginYaml(name: string, content: string): Promise<void> {
  const dir = join(home, '.nuka', 'plugins', name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'plugin.yaml'), content, 'utf8')
}

describe('plugin list — data layer', () => {
  it('returns plugins with all metadata fields populated', async () => {
    const meta = {
      version: '2.0.0',
      description: 'A great plugin',
      author: 'Alice <alice@example.com>',
      homepage: 'https://alice.example.com',
      repository: 'https://github.com/alice/plugin',
      license: 'MIT',
      keywords: ['ai', 'productivity'],
    }
    const dir = join(home, '.nuka', 'plugins', 'full-plugin')
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'plugin.json'),
      JSON.stringify({ name: 'full-plugin', ...meta }),
      'utf8',
    )
    const plugins = await loadPlugins({ home })
    expect(plugins).toHaveLength(1)
    const m = plugins[0]!.manifest
    expect(m.author).toBe('Alice <alice@example.com>')
    expect(m.homepage).toBe('https://alice.example.com')
    expect(m.repository).toBe('https://github.com/alice/plugin')
    expect(m.license).toBe('MIT')
    expect(m.keywords).toEqual(['ai', 'productivity'])
  })

  it('returns plugin with source: installed', async () => {
    const dir = join(home, '.nuka', 'plugins', 'my-plugin')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'plugin.json'), JSON.stringify({ name: 'my-plugin' }), 'utf8')
    const plugins = await loadPlugins({ home })
    expect(plugins[0]!.source).toBe('installed')
    expect(plugins[0]!.dir).toBeUndefined()
  })

  it('metadata fields are all optional', async () => {
    const dir = join(home, '.nuka', 'plugins', 'bare')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'plugin.json'), JSON.stringify({ name: 'bare' }), 'utf8')
    const plugins = await loadPlugins({ home })
    const m = plugins[0]!.manifest
    expect(m.author).toBeUndefined()
    expect(m.homepage).toBeUndefined()
    expect(m.repository).toBeUndefined()
    expect(m.license).toBeUndefined()
    expect(m.keywords).toBeUndefined()
  })
})
