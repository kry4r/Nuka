import { mkdir, readdir, rename, stat, symlink, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

/**
 * Compute the canonical cache directory path for a plugin version.
 *
 * Layout:
 *   ~/.nuka/plugins/cache/<source>/<key>/<version>/
 */
export function cacheDirFor(
  home: string,
  source: 'git' | 'npm' | 'bundle' | 'path',
  key: string,
  version: string,
): string {
  return join(home, '.nuka', 'plugins', 'cache', source, key, version)
}

/**
 * Atomically activate a specific cached version of a plugin by creating (or
 * repointing) a symlink at ~/.nuka/plugins/<pluginName> → cacheDir.
 *
 * Atomic strategy: write symlink to a tmp path then rename over the target.
 * This prevents a window where the symlink is absent or pointing to nothing.
 */
export async function activateVersion(
  home: string,
  pluginName: string,
  cacheDir: string,
): Promise<void> {
  const pluginsDir = join(home, '.nuka', 'plugins')
  await mkdir(pluginsDir, { recursive: true })

  const target = join(pluginsDir, pluginName)
  const tmpLink = join(pluginsDir, `.tmp-${randomBytes(8).toString('hex')}-${pluginName}`)

  // Create tmp symlink
  await symlink(cacheDir, tmpLink)

  // Atomically rename over target — this replaces any existing symlink/dir
  try {
    await rename(tmpLink, target)
  } catch (err) {
    // Clean up tmp on failure
    await unlink(tmpLink).catch(() => undefined)
    throw err
  }
}

/**
 * List all cached versions for a plugin under any source type.
 *
 * Scans ~/.nuka/plugins/cache/<source>/<key>/ directories looking for
 * version subdirectories where the key matches the plugin name or a hash.
 *
 * Since the key can be a hash (for git/npm), we scan all source types
 * and all keys, looking for version directories that correspond to this plugin.
 *
 * For this function, we use a simpler convention: the plugin name IS the key
 * for npm (safeName) and path sources. For git sources the key is a URL hash.
 *
 * Returns all found version strings across all source types for the given
 * pluginName as the key.
 */
export async function listInstalledVersions(home: string, pluginName: string): Promise<string[]> {
  const cacheBase = join(home, '.nuka', 'plugins', 'cache')
  const versions: string[] = []

  let sourceTypes: string[]
  try {
    sourceTypes = await readdir(cacheBase)
  } catch {
    return []
  }

  for (const sourceType of sourceTypes) {
    const sourceDir = join(cacheBase, sourceType)
    let keys: string[]
    try {
      const s = await stat(sourceDir)
      if (!s.isDirectory()) continue
      keys = await readdir(sourceDir)
    } catch {
      continue
    }

    for (const key of keys) {
      if (key === '_work') continue // skip npm work dir
      const keyDir = join(sourceDir, key)
      let versionEntries: string[]
      try {
        const s = await stat(keyDir)
        if (!s.isDirectory()) continue
        versionEntries = await readdir(keyDir)
      } catch {
        continue
      }

      // Check each version subdir for a plugin manifest with this name
      for (const ver of versionEntries) {
        if (ver.startsWith('.tmp-') || ver === '_staging') continue
        const verDir = join(keyDir, ver)
        try {
          const s = await stat(verDir)
          if (!s.isDirectory()) continue
          // Check if this directory contains a manifest for this plugin
          for (const manifestFile of ['plugin.yaml', 'plugin.json']) {
            const manifestPath = join(verDir, manifestFile)
            try {
              const raw = await import('node:fs/promises').then(fs => fs.readFile(manifestPath, 'utf8'))
              const { parse: parseYaml } = await import('yaml')
              const data = parseYaml(raw) as Record<string, unknown>
              if (data['name'] === pluginName) {
                versions.push(ver)
              }
              break
            } catch {
              // try next manifest file
            }
          }
        } catch {
          continue
        }
      }
    }
  }

  return versions
}
