/**
 * Session plugin loader: loads plugins from an arbitrary directory at CLI startup.
 * Session plugins bypass the enabledPlugins filter and are tagged source: 'session'.
 * They are not persisted to config — they only exist for the lifetime of the process.
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { PluginManifestSchema, type LoadedPlugin } from './manifest'

/**
 * Scan a single directory for plugin sub-directories and load any valid plugins found.
 * Returns an array of LoadedPlugin with source: 'session' and dir set to the directory.
 */
export async function loadSessionPluginsFromDir(dir: string): Promise<LoadedPlugin[]> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      console.warn(`[plugin] --plugin-dir '${dir}' does not exist; skipping`)
      return []
    }
    console.warn(`[plugin] --plugin-dir '${dir}': cannot read directory — ${(err as Error).message}`)
    return []
  }

  const plugins: LoadedPlugin[] = []

  for (const name of entries.sort()) {
    const pluginDir = join(dir, name)

    let isDir = false
    try {
      const s = await stat(pluginDir)
      isDir = s.isDirectory()
    } catch {
      continue
    }
    if (!isDir) continue

    let raw: string | undefined
    let manifestFilename: string | undefined
    for (const filename of ['plugin.yaml', 'plugin.json']) {
      try {
        raw = await readFile(join(pluginDir, filename), 'utf8')
        manifestFilename = filename
        break
      } catch {
        // try next
      }
    }

    if (raw === undefined || manifestFilename === undefined) continue

    let data: unknown
    try {
      data = parseYaml(raw)
    } catch (err: unknown) {
      console.warn(`[plugin:session] ${name}: failed to parse manifest — ${(err as Error).message}`)
      continue
    }

    let manifest: ReturnType<typeof PluginManifestSchema.parse>
    try {
      manifest = PluginManifestSchema.parse(data)
    } catch (err: unknown) {
      console.warn(`[plugin:session] ${name}: invalid manifest — ${(err as Error).message}`)
      continue
    }

    plugins.push({ manifest, rootDir: pluginDir, source: 'session', dir })
  }

  return plugins
}
