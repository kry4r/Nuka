import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import os from 'node:os'
import { loadPlugins } from '../../../src/core/plugin/loader'

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(os.tmpdir(), 'nuka-plugins-'))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

async function makePlugin(name: string, filename: string, content: string): Promise<void> {
  const dir = join(home, '.nuka', 'plugins', name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, filename), content, 'utf8')
}

describe('loadPlugins', () => {
  it('returns [] when plugins dir does not exist', async () => {
    const result = await loadPlugins({ home })
    expect(result).toEqual([])
  })

  it('loads valid yaml and json plugins, skips bad ones', async () => {
    // good: valid yaml manifest
    await makePlugin('good', 'plugin.yaml', 'name: good-plugin\ndescription: A good plugin\n')

    // bad-json: invalid JSON
    await makePlugin('bad-json', 'plugin.json', '{ this is not json }')

    // missing-name: valid YAML but no name field
    await makePlugin('missing-name', 'plugin.yaml', 'description: no name here\n')

    // json-only: valid JSON manifest (fallback path)
    await makePlugin('json-only', 'plugin.json', JSON.stringify({ name: 'json-only' }))

    // no-manifest: directory with no plugin.{yaml,json}
    await mkdir(join(home, '.nuka', 'plugins', 'no-manifest'), { recursive: true })

    const result = await loadPlugins({ home })
    expect(result).toHaveLength(2)
    const names = result.map(p => p.manifest.name)
    expect(names).toContain('good-plugin')
    expect(names).toContain('json-only')
  })

  it('good plugin rootDir is absolute and points to the directory', async () => {
    await makePlugin('good', 'plugin.yaml', 'name: my-plugin\n')
    const result = await loadPlugins({ home })
    expect(result).toHaveLength(1)
    expect(result[0].rootDir).toBe(join(home, '.nuka', 'plugins', 'good'))
  })

  it('returns plugins in deterministic directory-name-sorted order', async () => {
    await makePlugin('zebra', 'plugin.yaml', 'name: zebra\n')
    await makePlugin('alpha', 'plugin.yaml', 'name: alpha\n')
    await makePlugin('middle', 'plugin.yaml', 'name: middle\n')
    const result = await loadPlugins({ home })
    expect(result.map(p => p.manifest.name)).toEqual(['alpha', 'middle', 'zebra'])
  })
})
