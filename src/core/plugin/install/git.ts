import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { execa, ExecaError } from 'execa'

/**
 * Clone a git repository (--depth 1) and return the cache directory
 * and the short SHA of the cloned HEAD.
 */
export async function installFromGit(opts: {
  gitUrl: string
  branch?: string
  home: string
}): Promise<{ cacheDir: string; version: string }> {
  // Verify git is available
  try {
    await execa('git', ['--version'])
  } catch {
    throw new Error(
      'git is not available on PATH. Please install git and try again.',
    )
  }

  // Compute an 8-hex-char URL hash for the cache path
  const urlHash = createHash('sha256').update(opts.gitUrl).digest('hex').slice(0, 8)

  // We'll clone into a temp dir first, determine version, then move to versioned path
  const cloneBaseDir = join(opts.home, '.nuka', 'plugins', 'cache', 'git', urlHash)
  await mkdir(cloneBaseDir, { recursive: true })

  // Clone into a staging directory
  const stagingDir = join(cloneBaseDir, '_staging')

  const cloneArgs = ['clone', '--depth', '1']
  if (opts.branch) {
    cloneArgs.push('--branch', opts.branch)
  }
  cloneArgs.push(opts.gitUrl, stagingDir)

  try {
    await execa('git', cloneArgs)
  } catch (err) {
    if (err instanceof ExecaError) {
      throw new Error(
        `git clone failed for ${opts.gitUrl}: ${err.stderr || err.message}`,
      )
    }
    throw err
  }

  // Get short SHA
  let version: string
  try {
    const result = await execa('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: stagingDir,
    })
    version = result.stdout.trim()
  } catch (err) {
    if (err instanceof ExecaError) {
      throw new Error(
        `git rev-parse failed: ${err.stderr || err.message}`,
      )
    }
    throw err
  }

  // Move staging dir to versioned path
  const versionedDir = join(cloneBaseDir, version)

  // Check if version already exists (idempotent install)
  try {
    await import('node:fs/promises').then(fs => fs.stat(versionedDir))
    // Already exists — remove staging dir and return existing
    await import('node:fs/promises').then(fs => fs.rm(stagingDir, { recursive: true, force: true }))
    return { cacheDir: versionedDir, version }
  } catch {
    // Does not exist — rename staging to versioned
  }

  await import('node:fs/promises').then(fs => fs.rename(stagingDir, versionedDir))

  return { cacheDir: versionedDir, version }
}
