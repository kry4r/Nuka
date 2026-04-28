import { cp, chmod, mkdir, readFile, stat, symlink, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
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

  // Link bin entries into ~/.nuka/bin/
  if (manifest.bin && Object.keys(manifest.bin).length > 0) {
    await linkBins(manifest, targetDir, opts.home)
  }

  return {
    name: manifest.name,
    targetDir,
    toolsCount: manifest.tools.length,
    slashCount: manifest.slashCommands.length,
    skillsCount: manifest.skills.length,
  }
}

/**
 * Symlink (POSIX) or write a .cmd shim (Windows) for each entry in
 * `manifest.bin` into `<home>/.nuka/bin/`.
 *
 * If the target already exists it is replaced with a warning (not thrown).
 * The target executable is also chmod'd +x on POSIX.
 *
 * @param manifest - plugin manifest containing the bin map
 * @param pluginRoot - absolute path to the installed plugin directory
 * @param home - user home directory (defaults to os.homedir())
 */
export async function linkBins(
  manifest: PluginManifest,
  pluginRoot: string,
  home: string = os.homedir(),
): Promise<void> {
  if (!manifest.bin || Object.keys(manifest.bin).length === 0) return

  const binDir = join(home, '.nuka', 'bin')
  await mkdir(binDir, { recursive: true })

  for (const [name, relPath] of Object.entries(manifest.bin)) {
    const targetFile = resolve(pluginRoot, relPath)

    if (process.platform === 'win32') {
      const linkPath = join(binDir, `${name}.cmd`)
      // Remove existing shim before writing
      try {
        await unlink(linkPath)
      } catch {
        // ok if it doesn't exist
      }
      try {
        await writeFile(linkPath, `@node "${targetFile}" %*\r\n`, 'utf8')
      } catch (err) {
        console.warn(`[plugin] bin link failed for '${name}': ${(err as Error).message}`)
      }
    } else {
      const linkPath = join(binDir, name)
      // Remove existing symlink/file before creating new one
      try {
        await unlink(linkPath)
        console.warn(`[plugin] replaced existing bin entry at ${linkPath}`)
      } catch {
        // ok if it doesn't exist
      }
      try {
        await chmod(targetFile, 0o755)
        await symlink(targetFile, linkPath)
      } catch (err) {
        console.warn(`[plugin] bin link failed for '${name}': ${(err as Error).message}`)
      }
    }
  }
}

/**
 * Remove symlinks or .cmd shims that were installed by {@link linkBins}.
 * Called on plugin uninstall. Missing entries are silently ignored.
 *
 * @param manifest - plugin manifest containing the bin map
 * @param home - user home directory (defaults to os.homedir())
 */
export async function unlinkBins(
  manifest: PluginManifest,
  home: string = os.homedir(),
): Promise<void> {
  if (!manifest.bin || Object.keys(manifest.bin).length === 0) return

  const binDir = join(home, '.nuka', 'bin')

  for (const name of Object.keys(manifest.bin)) {
    const linkPath = process.platform === 'win32'
      ? join(binDir, `${name}.cmd`)
      : join(binDir, name)

    try {
      await unlink(linkPath)
    } catch {
      // already gone — that's fine
    }
  }
}
