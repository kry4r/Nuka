/**
 * Background auto-update for marketplace plugin repositories.
 *
 * Design: marketplace repos live at ~/.nuka/marketplaces/<name>/ as git clones.
 * `updateMarketplace` runs `git pull --ff-only` in that directory.
 * `updateAllMarketplaces` scans ~/.nuka/marketplaces/ and updates each one.
 *
 * Injection: the `execGitPull` dep is injected so tests can mock it without
 * touching the filesystem or running real git. Production callers use the default.
 */
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { execa } from 'execa'

export type UpdateResult = { name: string; changed: boolean }

/** Injectable git-pull executor — returns true if HEAD moved. */
export type GitPullFn = (repoPath: string) => Promise<boolean>

/**
 * Default implementation: runs `git pull --ff-only` and detects whether
 * HEAD moved by capturing stdout ("Already up to date." means no change).
 */
export const defaultGitPull: GitPullFn = async (repoPath: string): Promise<boolean> => {
  const result = await execa('git', ['pull', '--ff-only'], {
    cwd: repoPath,
    reject: false,
  })
  if (result.exitCode !== 0) {
    throw new Error(`git pull failed in ${repoPath}: ${result.stderr}`)
  }
  // git prints "Already up to date." when nothing changed
  const already = result.stdout.trim().toLowerCase().includes('already up to date')
  return !already
}

/**
 * Update a single marketplace repo by name.
 *
 * @param home   - User's home directory (e.g. os.homedir())
 * @param name   - Marketplace name (directory under ~/.nuka/marketplaces/)
 * @param gitPull - Injectable; defaults to `defaultGitPull`
 */
export async function updateMarketplace(
  home: string,
  name: string,
  gitPull: GitPullFn = defaultGitPull,
): Promise<{ changed: boolean }> {
  const repoPath = join(home, '.nuka', 'marketplaces', name)
  const changed = await gitPull(repoPath)
  return { changed }
}

/**
 * Update all marketplace repos found under ~/.nuka/marketplaces/.
 * Repos that fail are logged but do not abort the others.
 *
 * @param home    - User's home directory
 * @param gitPull - Injectable; defaults to `defaultGitPull`
 */
export async function updateAllMarketplaces(
  home: string,
  gitPull: GitPullFn = defaultGitPull,
): Promise<Array<UpdateResult>> {
  const marketplacesDir = join(home, '.nuka', 'marketplaces')

  let entries: string[]
  try {
    entries = await readdir(marketplacesDir)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }

  const results: UpdateResult[] = []

  for (const name of entries.sort()) {
    const repoPath = join(marketplacesDir, name)
    let isDir = false
    try {
      const s = await stat(repoPath)
      isDir = s.isDirectory()
    } catch {
      continue
    }
    if (!isDir) continue

    try {
      const { changed } = await updateMarketplace(home, name, gitPull)
      results.push({ name, changed })
    } catch (err: unknown) {
      console.warn(`[autoupdate] failed to update marketplace '${name}': ${(err as Error).message}`)
      results.push({ name, changed: false })
    }
  }

  return results
}

/**
 * Fire-and-forget auto-update startup hook.
 * Call this non-blocking when `config.plugins.autoUpdate === true`.
 */
export function startAutoUpdate(
  home: string,
  gitPull: GitPullFn = defaultGitPull,
): void {
  void updateAllMarketplaces(home, gitPull).catch((err: unknown) => {
    console.warn(`[autoupdate] unexpected error: ${(err as Error).message}`)
  })
}
