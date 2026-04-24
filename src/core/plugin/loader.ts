import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { PluginManifestSchema, type LoadedPlugin } from './manifest'
import { loadSessionPluginsFromDir } from './sessionPlugins'

export async function loadPlugins(opts: {
  home: string
  enabled?: string[]
  /** Additional directories to scan for session-only plugins (from --plugin-dir) */
  extraDirs?: string[]
}): Promise<LoadedPlugin[]> {
  const pluginsDir = join(opts.home, '.nuka', 'plugins')

  let entries: string[]
  try {
    entries = await readdir(pluginsDir)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[plugin] cannot read plugins dir: ${(err as Error).message}`)
    }
    entries = []
  }

  const plugins: LoadedPlugin[] = []

  for (const name of entries.sort()) {
    const dir = join(pluginsDir, name)

    let isDir = false
    try {
      const s = await stat(dir)
      isDir = s.isDirectory()
    } catch {
      continue
    }
    if (!isDir) continue

    let raw: string | undefined
    let manifestFilename: string | undefined
    for (const filename of ['plugin.yaml', 'plugin.json']) {
      try {
        raw = await readFile(join(dir, filename), 'utf8')
        manifestFilename = filename
        break
      } catch {
        // try next
      }
    }

    if (raw === undefined || manifestFilename === undefined) continue

    if (manifestFilename === 'plugin.yaml') {
      console.warn(
        `[nuka] plugin '${name}' uses plugin.yaml; note YAML is Nuka-specific and not portable to Nuka-Code. See docs/plugins.md`,
      )
    }

    let data: unknown
    try {
      data = parseYaml(raw)
    } catch (err: unknown) {
      console.warn(`[plugin] ${name}: failed to parse manifest — ${(err as Error).message}`)
      continue
    }

    let manifest: ReturnType<typeof PluginManifestSchema.parse>
    try {
      manifest = PluginManifestSchema.parse(data)
    } catch (err: unknown) {
      console.warn(`[plugin] ${name}: invalid manifest — ${(err as Error).message}`)
      continue
    }

    plugins.push({ manifest, rootDir: dir, source: 'installed' })
  }

  if (opts.enabled !== undefined) {
    const allowed = new Set(opts.enabled)
    plugins.splice(0, plugins.length, ...plugins.filter(p => allowed.has(p.manifest.name)))
  }

  // Load session plugins from extraDirs (bypass enabled filter)
  if (opts.extraDirs && opts.extraDirs.length > 0) {
    const installedNames = new Set(plugins.map(p => p.manifest.name))
    for (const extraDir of opts.extraDirs) {
      const sessionPlugins = await loadSessionPluginsFromDir(extraDir)
      for (const sp of sessionPlugins) {
        if (installedNames.has(sp.manifest.name)) {
          console.warn(
            `[plugin] session plugin '${sp.manifest.name}' conflicts with installed plugin of the same name; installed wins — skipping session copy`,
          )
          continue
        }
        plugins.push(sp)
        installedNames.add(sp.manifest.name)
      }
    }
  }

  return plugins
}
