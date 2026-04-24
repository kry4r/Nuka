import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, readlink, stat } from 'node:fs/promises'
import { join } from 'node:path'
import os from 'node:os'
import {
  cacheDirFor,
  activateVersion,
  listInstalledVersions,
} from '../../../src/core/plugin/versionCache'

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(os.tmpdir(), 'nuka-vcache-'))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

/**
 * Create a fake cached plugin version directory with a plugin.yaml manifest.
 */
async function createCachedVersion(
  home: string,
  source: 'git' | 'npm' | 'bundle' | 'path',
  key: string,
  version: string,
  pluginName: string,
): Promise<string> {
  const dir = cacheDirFor(home, source, key, version)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'plugin.yaml'), `name: ${pluginName}\nversion: ${version}\n`, 'utf8')
  return dir
}

describe('cacheDirFor', () => {
  it('returns expected path structure', () => {
    const dir = cacheDirFor(home, 'npm', 'my-plugin', '1.0.0')
    expect(dir).toContain('.nuka/plugins/cache/npm/my-plugin/1.0.0')
    expect(dir.startsWith(home)).toBe(true)
  })

  it('handles all source types', () => {
    for (const source of ['git', 'npm', 'bundle', 'path'] as const) {
      const dir = cacheDirFor(home, source, 'key', 'v1')
      expect(dir).toContain(`/cache/${source}/key/v1`)
    }
  })
})

describe('activateVersion', () => {
  it('creates a symlink at ~/.nuka/plugins/<pluginName>', async () => {
    const cacheDir = await createCachedVersion(home, 'npm', 'my-plugin', '1.0.0', 'my-plugin')

    await activateVersion(home, 'my-plugin', cacheDir)

    const linkPath = join(home, '.nuka', 'plugins', 'my-plugin')
    const target = await readlink(linkPath)
    expect(target).toBe(cacheDir)
  })

  it('atomically repoints symlink to new version', async () => {
    const cacheDir1 = await createCachedVersion(home, 'npm', 'my-plugin', '1.0.0', 'my-plugin')
    const cacheDir2 = await createCachedVersion(home, 'npm', 'my-plugin', '2.0.0', 'my-plugin')

    await activateVersion(home, 'my-plugin', cacheDir1)
    await activateVersion(home, 'my-plugin', cacheDir2)

    const linkPath = join(home, '.nuka', 'plugins', 'my-plugin')
    const target = await readlink(linkPath)
    expect(target).toBe(cacheDir2)
  })

  it('symlink target is a readable directory', async () => {
    const cacheDir = await createCachedVersion(home, 'git', 'abc12345', 'abc1234', 'git-plugin')

    await activateVersion(home, 'git-plugin', cacheDir)

    const linkPath = join(home, '.nuka', 'plugins', 'git-plugin')
    // stat follows the symlink
    const s = await stat(linkPath)
    expect(s.isDirectory()).toBe(true)
  })
})

describe('listInstalledVersions', () => {
  it('returns empty array when cache is empty', async () => {
    const versions = await listInstalledVersions(home, 'my-plugin')
    expect(versions).toEqual([])
  })

  it('returns all cached versions for a plugin', async () => {
    await createCachedVersion(home, 'npm', 'my-plugin', '1.0.0', 'my-plugin')
    await createCachedVersion(home, 'npm', 'my-plugin', '2.0.0', 'my-plugin')
    await createCachedVersion(home, 'npm', 'my-plugin', '3.0.0', 'my-plugin')

    const versions = await listInstalledVersions(home, 'my-plugin')
    expect(versions).toHaveLength(3)
    expect(versions).toContain('1.0.0')
    expect(versions).toContain('2.0.0')
    expect(versions).toContain('3.0.0')
  })

  it('does not return versions of other plugins', async () => {
    await createCachedVersion(home, 'npm', 'plugin-a', '1.0.0', 'plugin-a')
    await createCachedVersion(home, 'npm', 'plugin-b', '1.0.0', 'plugin-b')

    const versions = await listInstalledVersions(home, 'plugin-a')
    expect(versions).toHaveLength(1)
    expect(versions).toContain('1.0.0')
  })

  it('returns versions across multiple source types', async () => {
    await createCachedVersion(home, 'npm', 'multi-plugin', '1.0.0', 'multi-plugin')
    await createCachedVersion(home, 'git', 'abc12345', 'abc1234', 'multi-plugin')

    const versions = await listInstalledVersions(home, 'multi-plugin')
    expect(versions).toHaveLength(2)
  })
})
