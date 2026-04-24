import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { PluginManifestSchema, type LoadedPlugin } from './manifest'

export async function loadPlugins(opts: { home: string; enabled?: string[] }): Promise<LoadedPlugin[]> {
  const pluginsDir = join(opts.home, '.nuka', 'plugins')

  let entries: string[]
  try {
    entries = await readdir(pluginsDir)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    console.warn(`[plugin] cannot read plugins dir: ${(err as Error).message}`)
    return []
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

    plugins.push({ manifest, rootDir: dir })
  }

  if (opts.enabled !== undefined) {
    const allowed = new Set(opts.enabled)
    return plugins.filter(p => allowed.has(p.manifest.name))
  }

  return plugins
}
