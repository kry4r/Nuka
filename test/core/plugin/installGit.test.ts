import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import os from 'node:os'
import { execa } from 'execa'
import { installFromGit } from '../../../src/core/plugin/install/git'

let home: string
let repoDir: string

beforeEach(async () => {
  home = await mkdtemp(join(os.tmpdir(), 'nuka-git-home-'))
  repoDir = await mkdtemp(join(os.tmpdir(), 'nuka-git-repo-'))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
  await rm(repoDir, { recursive: true, force: true })
})

/**
 * Creates a minimal local git repository with one commit.
 * Returns the repo path (file:// URL compatible).
 */
async function createLocalRepo(dir: string): Promise<string> {
  await execa('git', ['init', dir])
  await execa('git', ['-C', dir, 'config', 'user.email', 'test@test.com'])
  await execa('git', ['-C', dir, 'config', 'user.name', 'Test'])
  await writeFile(join(dir, 'plugin.yaml'), 'name: git-plugin\n')
  await execa('git', ['-C', dir, 'add', '.'])
  await execa('git', ['-C', dir, 'commit', '-m', 'init'])
  return dir
}

describe('installFromGit', () => {
  it('clones a local bare repo and returns a short SHA version', { timeout: 15000 }, async () => {
    const repoPath = await createLocalRepo(repoDir)

    const result = await installFromGit({
      gitUrl: `file://${repoPath}`,
      home,
    })

    expect(result.version).toMatch(/^[0-9a-f]{7}$/)
    expect(result.cacheDir).toContain('.nuka/plugins/cache/git/')
    expect(result.cacheDir).toContain(result.version)

    // Check that plugin.yaml exists in the cloned directory
    const { stat } = await import('node:fs/promises')
    const s = await stat(join(result.cacheDir, 'plugin.yaml'))
    expect(s.isFile()).toBe(true)
  })

  it('is idempotent — second install with same URL returns same version', { timeout: 15000 }, async () => {
    const repoPath = await createLocalRepo(repoDir)
    const url = `file://${repoPath}`

    const result1 = await installFromGit({ gitUrl: url, home })
    const result2 = await installFromGit({ gitUrl: url, home })

    expect(result1.version).toBe(result2.version)
    expect(result1.cacheDir).toBe(result2.cacheDir)
  })

  it('uses the URL hash as part of the cache path', { timeout: 15000 }, async () => {
    const repoPath = await createLocalRepo(repoDir)
    const url = `file://${repoPath}`

    const result = await installFromGit({ gitUrl: url, home })

    // The URL hash should be 8 hex chars
    const parts = result.cacheDir.split('/')
    const gitIdx = parts.indexOf('git')
    expect(gitIdx).toBeGreaterThan(-1)
    const hash = parts[gitIdx + 1]
    expect(hash).toMatch(/^[0-9a-f]{8}$/)
  })

  it('fails with a clear error for an invalid git URL', async () => {
    await expect(
      installFromGit({
        gitUrl: 'file:///nonexistent/path/repo',
        home,
      }),
    ).rejects.toThrow('git clone failed')
  })
})
