/**
 * Helpers for per-plugin user configuration.
 * Config is persisted at: ~/.nuka/plugins/<name>/.userconfig.json
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { LoadedPlugin } from './manifest'

export function getUserConfigPath(home: string, pluginName: string): string {
  return join(home, '.nuka', 'plugins', pluginName, '.userconfig.json')
}

/**
 * Read persisted user config for a plugin.
 * Returns null if the file does not exist or cannot be parsed.
 */
export async function readUserConfig(
  home: string,
  pluginName: string,
): Promise<Record<string, unknown> | null> {
  const configPath = getUserConfigPath(home, pluginName)
  let raw: string
  try {
    raw = await readFile(configPath, 'utf8')
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    console.warn(`[plugin:${pluginName}] failed to read userconfig: ${(err as Error).message}`)
    return null
  }
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    console.warn(`[plugin:${pluginName}] userconfig is not an object; ignoring`)
    return null
  } catch {
    console.warn(`[plugin:${pluginName}] userconfig is not valid JSON; ignoring`)
    return null
  }
}

/**
 * Persist user config for a plugin.
 * Creates the plugin directory if it doesn't exist.
 */
export async function writeUserConfig(
  home: string,
  pluginName: string,
  config: Record<string, unknown>,
): Promise<void> {
  const configPath = getUserConfigPath(home, pluginName)
  const dir = join(home, '.nuka', 'plugins', pluginName)
  await mkdir(dir, { recursive: true })
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8')
}

/**
 * Returns true when the plugin declares userConfig.fields and no persisted config exists.
 * A result of true means the TUI should prompt the user before wiring the plugin.
 */
export async function needsUserConfigPrompt(plugin: LoadedPlugin, home: string): Promise<boolean> {
  const fields = plugin.manifest.userConfig?.fields
  if (!fields || fields.length === 0) return false
  const existing = await readUserConfig(home, plugin.manifest.name)
  return existing === null
}
