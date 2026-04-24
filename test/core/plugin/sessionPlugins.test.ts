import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import os from 'node:os'
import { loadSessionPluginsFromDir } from '../../../src/core/plugin/sessionPlugins'
import { loadPlugins } from '../../../src/core/plugin/loader'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(join(os.tmpdir(), 'nuka-session-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

async function makePlugin(baseDir: string, name: string, content: string): Promise<void> {
  const dir = join(baseDir, name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'plugin.json'), content, 'utf8')
}

describe('loadSessionPluginsFromDir', () => {
  it('returns [] when directory does not exist', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await loadSessionPluginsFromDir(join(tmpDir, 'nonexistent'))
    expect(result).toEqual([])
    expect(warnSpy.mock.calls.some(c => String(c[0]).includes('does not exist'))).toBe(true)
    warnSpy.mockRestore()
  })

  it('loads a valid plugin as source: session', async () => {
    await makePlugin(tmpDir, 'bar', JSON.stringify({ name: 'bar' }))
    const result = await loadSessionPluginsFromDir(tmpDir)
    expect(result).toHaveLength(1)
    expect(result[0]!.manifest.name).toBe('bar')
    expect(result[0]!.source).toBe('session')
    expect(result[0]!.dir).toBe(tmpDir)
  })

  it('skips subdirectories without a manifest', async () => {
    await mkdir(join(tmpDir, 'no-manifest'), { recursive: true })
    await makePlugin(tmpDir, 'good', JSON.stringify({ name: 'good' }))
    const result = await loadSessionPluginsFromDir(tmpDir)
    expect(result).toHaveLength(1)
    expect(result[0]!.manifest.name).toBe('good')
  })

  it('skips plugins with invalid manifests', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await makePlugin(tmpDir, 'bad', '{ bad json }')
    const result = await loadSessionPluginsFromDir(tmpDir)
    expect(result).toHaveLength(0)
    warnSpy.mockRestore()
  })

  it('returns plugins sorted by directory name', async () => {
    await makePlugin(tmpDir, 'zebra', JSON.stringify({ name: 'zebra' }))
    await makePlugin(tmpDir, 'alpha', JSON.stringify({ name: 'alpha' }))
    const result = await loadSessionPluginsFromDir(tmpDir)
    expect(result.map(p => p.manifest.name)).toEqual(['alpha', 'zebra'])
  })
})

describe('loadPlugins with extraDirs', () => {
  let home: string
  let sessionDir: string

  beforeEach(async () => {
    home = await mkdtemp(join(os.tmpdir(), 'nuka-home-'))
    sessionDir = await mkdtemp(join(os.tmpdir(), 'nuka-sess-'))
  })

  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
    await rm(sessionDir, { recursive: true, force: true })
  })

  async function makeInstalledPlugin(name: string): Promise<void> {
    const dir = join(home, '.nuka', 'plugins', name)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'plugin.json'), JSON.stringify({ name }), 'utf8')
  }

  it('loads session plugins from extraDirs in addition to home', async () => {
    await makeInstalledPlugin('a')
    await makePlugin(sessionDir, 'b', JSON.stringify({ name: 'b' }))
    const result = await loadPlugins({ home, enabled: ['a'], extraDirs: [sessionDir] })
    const names = result.map(p => p.manifest.name).sort()
    expect(names).toEqual(['a', 'b'])
    expect(result.find(p => p.manifest.name === 'a')!.source).toBe('installed')
    expect(result.find(p => p.manifest.name === 'b')!.source).toBe('session')
  })

  it('installed plugin wins when name collides with session plugin', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await makeInstalledPlugin('c')
    await makePlugin(sessionDir, 'c', JSON.stringify({ name: 'c' }))
    const result = await loadPlugins({ home, extraDirs: [sessionDir] })
    expect(result).toHaveLength(1)
    expect(result[0]!.source).toBe('installed')
    expect(warnSpy.mock.calls.some(c => String(c[0]).includes("conflicts with installed plugin"))).toBe(true)
    warnSpy.mockRestore()
  })

  it('session plugins bypass the enabled filter', async () => {
    // Only 'a' in enabled; session 'b' should still load
    await makeInstalledPlugin('a')
    await makeInstalledPlugin('z')
    await makePlugin(sessionDir, 'b', JSON.stringify({ name: 'b' }))
    const result = await loadPlugins({ home, enabled: ['a'], extraDirs: [sessionDir] })
    const names = result.map(p => p.manifest.name).sort()
    expect(names).toEqual(['a', 'b'])
  })

  it('handles multiple extraDirs', async () => {
    const sessionDir2 = await mkdtemp(join(os.tmpdir(), 'nuka-sess2-'))
    try {
      await makePlugin(sessionDir, 'x', JSON.stringify({ name: 'x' }))
      await makePlugin(sessionDir2, 'y', JSON.stringify({ name: 'y' }))
      const result = await loadPlugins({ home, extraDirs: [sessionDir, sessionDir2] })
      const names = result.map(p => p.manifest.name).sort()
      expect(names).toEqual(['x', 'y'])
    } finally {
      await rm(sessionDir2, { recursive: true, force: true })
    }
  })
})
