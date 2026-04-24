import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { execa, ExecaError } from 'execa'
import { parse as parseYaml } from 'yaml'

/**
 * Install a plugin from npm registry.
 *
 * Flow:
 *  1. npm pack <pkg>[@<version>] → writes .tgz file
 *  2. Extract tarball using the `tar` command (Node built-in zlib handles gzip,
 *     but we shell out to `tar` for the full extraction — no new npm dep)
 *  3. Locate package/plugin.yaml or package/plugin.json
 *  4. Security guard: reject if package.json declares lifecycle scripts
 *  5. Copy to ~/.nuka/plugins/cache/npm/<safeName>/<version>/
 */
export async function installFromNpm(opts: {
  pkg: string
  version?: string
  home: string
}): Promise<{ cacheDir: string; version: string }> {
  const pkgSpec = opts.version ? `${opts.pkg}@${opts.version}` : opts.pkg

  // Working directory for npm pack
  const workDir = join(opts.home, '.nuka', 'plugins', 'cache', 'npm', '_work')
  await mkdir(workDir, { recursive: true })

  // Run npm pack — outputs a filename like "my-plugin-1.0.0.tgz"
  let packOutput: string
  try {
    const result = await execa('npm', ['pack', pkgSpec, '--pack-destination', workDir])
    packOutput = result.stdout.trim()
  } catch (err) {
    if (err instanceof ExecaError) {
      throw new Error(`npm pack failed for ${pkgSpec}: ${err.stderr || err.message}`)
    }
    throw err
  }

  // packOutput may be just the filename
  const tarballPath = packOutput.startsWith('/') ? packOutput : join(workDir, packOutput)

  // Extract tarball to a staging dir
  const stagingDir = join(
    workDir,
    `staging-${createHash('sha256').update(tarballPath).digest('hex').slice(0, 8)}`,
  )
  await mkdir(stagingDir, { recursive: true })

  try {
    await execa('tar', ['xzf', tarballPath, '-C', stagingDir])
  } catch (err) {
    if (err instanceof ExecaError) {
      throw new Error(`tar extraction failed: ${err.stderr || err.message}`)
    }
    throw err
  }

  // npm pack always extracts into a "package/" subdirectory
  const packageDir = join(stagingDir, 'package')

  // Security guard: read package.json and reject lifecycle scripts
  let pkgJson: Record<string, unknown> | null = null
  try {
    const raw = await readFile(join(packageDir, 'package.json'), 'utf8')
    pkgJson = JSON.parse(raw) as Record<string, unknown>
  } catch {
    // package.json may not exist — that's OK, continue
  }

  if (pkgJson !== null) {
    const scripts = pkgJson['scripts'] as Record<string, string> | undefined
    if (scripts) {
      const lifecycleScripts = ['preinstall', 'install', 'postinstall']
      const found = lifecycleScripts.filter(s => s in scripts)
      if (found.length > 0) {
        // Clean up staging before throwing
        await rm(stagingDir, { recursive: true, force: true })
        await rm(tarballPath, { force: true })
        throw new Error(
          `Refusing to install ${pkgSpec}: package declares lifecycle scripts (${found.join(', ')}) which could execute arbitrary code`,
        )
      }
    }
  }

  // Determine version from package.json or tarball name
  let version: string = opts.version ?? 'unknown'
  if (pkgJson !== null && typeof pkgJson['version'] === 'string') {
    version = pkgJson['version']
  }

  // Verify plugin manifest exists (plugin.yaml or plugin.json)
  let manifestFound = false
  for (const filename of ['plugin.yaml', 'plugin.json']) {
    try {
      await readFile(join(packageDir, filename), 'utf8')
      manifestFound = true
      break
    } catch {
      // try next
    }
  }

  if (!manifestFound) {
    await rm(stagingDir, { recursive: true, force: true })
    await rm(tarballPath, { force: true })
    throw new Error(
      `Package ${pkgSpec} does not contain a plugin.yaml or plugin.json manifest`,
    )
  }

  // Determine safe package name for cache path
  const safeName = opts.pkg.replace(/[^a-z0-9-]/gi, '_').toLowerCase()
  const cacheDir = join(opts.home, '.nuka', 'plugins', 'cache', 'npm', safeName, version)

  // Check if version already cached (idempotent)
  try {
    await import('node:fs/promises').then(fs => fs.stat(cacheDir))
    // Already exists — clean up staging
    await rm(stagingDir, { recursive: true, force: true })
    await rm(tarballPath, { force: true })
    return { cacheDir, version }
  } catch {
    // Does not exist — proceed
  }

  await mkdir(join(opts.home, '.nuka', 'plugins', 'cache', 'npm', safeName), { recursive: true })
  await rename(packageDir, cacheDir)
  await rm(stagingDir, { recursive: true, force: true })
  await rm(tarballPath, { force: true })

  return { cacheDir, version }
}
