import { cp, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { PluginManifestSchema, type PluginManifest } from './manifest'

export type InstallResult = {
  name: string
  targetDir: string
  toolsCount: number
  slashCount: number
  skillsCount: number
}

export async function readManifestFrom(sourceDir: string): Promise<PluginManifest> {
  let raw: string | undefined
  for (const filename of ['plugin.yaml', 'plugin.json']) {
    try {
      raw = await readFile(join(sourceDir, filename), 'utf8')
      break
    } catch {
      // try next
    }
  }
  if (raw === undefined) {
    throw new Error(`no plugin.yaml or plugin.json found in ${sourceDir}`)
  }
  let data: unknown
  try {
    data = parseYaml(raw)
  } catch (err) {
    throw new Error(`failed to parse manifest: ${(err as Error).message}`)
  }
  return PluginManifestSchema.parse(data)
}

export async function installPluginFromPath(opts: {
  source: string
  home: string
  force?: boolean
  confirm: () => Promise<boolean>
}): Promise<InstallResult> {
  const source = resolve(opts.source)

  const s = await stat(source).catch(() => {
    throw new Error(`source path does not exist: ${source}`)
  })
  if (!s.isDirectory()) {
    throw new Error(`source path is not a directory: ${source}`)
  }

  const manifest = await readManifestFrom(source)

  const targetDir = join(opts.home, '.nuka', 'plugins', manifest.name)

  let targetExists = false
  try {
    await stat(targetDir)
    targetExists = true
  } catch {
    // does not exist
  }

  if (targetExists && opts.force !== true) {
    throw new Error(
      `plugin '${manifest.name}' already installed at ${targetDir}. Re-run with force=true to overwrite.`,
    )
  }

  const confirmed = await opts.confirm()
  if (!confirmed) {
    throw new Error('install cancelled')
  }

  await cp(source, targetDir, { recursive: true, force: opts.force ?? false })

  return {
    name: manifest.name,
    targetDir,
    toolsCount: manifest.tools.length,
    slashCount: manifest.slashCommands.length,
    skillsCount: manifest.skills.length,
  }
}
