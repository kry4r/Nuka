import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import os from 'node:os'
import {
  updateMarketplace,
  updateAllMarketplaces,
  startAutoUpdate,
  type GitPullFn,
} from '../../../src/core/plugin/autoupdate'

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(os.tmpdir(), 'nuka-au-'))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

/** Helper: create a fake marketplace directory */
async function mkMarketplace(name: string): Promise<string> {
  const dir = join(home, '.nuka', 'marketplaces', name)
  await mkdir(dir, { recursive: true })
  return dir
}

describe('updateMarketplace', () => {
  it('returns { changed: false } when git pull reports already up to date', async () => {
    await mkMarketplace('official')
    const noOp: GitPullFn = async () => false
    const result = await updateMarketplace(home, 'official', noOp)
    expect(result).toEqual({ changed: false })
  })

  it('returns { changed: true } when git pull moved HEAD', async () => {
    await mkMarketplace('official')
    const moved: GitPullFn = async () => true
    const result = await updateMarketplace(home, 'official', moved)
    expect(result).toEqual({ changed: true })
  })

  it('propagates errors from gitPull', async () => {
    await mkMarketplace('bad-repo')
    const broken: GitPullFn = async () => {
      throw new Error('git pull failed')
    }
    await expect(updateMarketplace(home, 'bad-repo', broken)).rejects.toThrow('git pull failed')
  })
})

describe('updateAllMarketplaces', () => {
  it('returns empty array when marketplaces directory does not exist', async () => {
    const results = await updateAllMarketplaces(home)
    expect(results).toEqual([])
  })

  it('returns empty array when marketplaces directory is empty', async () => {
    await mkdir(join(home, '.nuka', 'marketplaces'), { recursive: true })
    const results = await updateAllMarketplaces(home)
    expect(results).toEqual([])
  })

  it('updates all marketplace directories', async () => {
    await mkMarketplace('alpha')
    await mkMarketplace('beta')

    const calls: string[] = []
    const mock: GitPullFn = async (repoPath) => {
      calls.push(repoPath)
      return false
    }

    const results = await updateAllMarketplaces(home, mock)
    expect(results).toHaveLength(2)
    expect(results.map(r => r.name).sort()).toEqual(['alpha', 'beta'])
    expect(results.every(r => !r.changed)).toBe(true)
    expect(calls).toHaveLength(2)
  })

  it('marks changed: true for repos where HEAD moved', async () => {
    await mkMarketplace('repo-a')
    await mkMarketplace('repo-b')

    const mock: GitPullFn = async (repoPath) => {
      return repoPath.endsWith('repo-a')
    }

    const results = await updateAllMarketplaces(home, mock)
    const byName = Object.fromEntries(results.map(r => [r.name, r.changed]))
    expect(byName['repo-a']).toBe(true)
    expect(byName['repo-b']).toBe(false)
  })

  it('continues updating other repos when one fails', async () => {
    await mkMarketplace('good')
    await mkMarketplace('bad')

    const mock: GitPullFn = async (repoPath) => {
      if (repoPath.endsWith('bad')) throw new Error('network error')
      return true
    }

    const results = await updateAllMarketplaces(home, mock)
    expect(results).toHaveLength(2)
    const byName = Object.fromEntries(results.map(r => [r.name, r.changed]))
    expect(byName['good']).toBe(true)
    expect(byName['bad']).toBe(false) // failed but didn't crash
  })

  it('skips non-directory entries', async () => {
    await mkdir(join(home, '.nuka', 'marketplaces'), { recursive: true })
    // Create a file, not a directory
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(home, '.nuka', 'marketplaces', 'not-a-dir.txt'), 'data')

    await mkMarketplace('real-repo')
    const calls: string[] = []
    const mock: GitPullFn = async (p) => { calls.push(p); return false }

    const results = await updateAllMarketplaces(home, mock)
    expect(results).toHaveLength(1)
    expect(results[0]!.name).toBe('real-repo')
    expect(calls).toHaveLength(1)
  })
})

describe('startAutoUpdate', () => {
  it('fires non-blocking update (does not await)', async () => {
    await mkMarketplace('test-repo')
    const calls: string[] = []
    const mock: GitPullFn = async (p) => {
      calls.push(p)
      return false
    }

    // startAutoUpdate should return immediately (void)
    const result = startAutoUpdate(home, mock)
    expect(result).toBeUndefined()

    // Give the promise microtask time to complete
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(calls).toHaveLength(1)
  })

  it('does not throw when marketplaces dir is absent', async () => {
    // No marketplaces dir — should silently succeed
    expect(() => startAutoUpdate(home)).not.toThrow()
    await new Promise(resolve => setTimeout(resolve, 50))
  })

  it('does not crash on gitPull error', async () => {
    await mkMarketplace('fragile')
    const broken: GitPullFn = async () => { throw new Error('boom') }
    expect(() => startAutoUpdate(home, broken)).not.toThrow()
    await new Promise(resolve => setTimeout(resolve, 50))
  })
})
