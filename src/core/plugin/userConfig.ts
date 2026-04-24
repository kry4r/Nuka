/**
 * Helpers for per-plugin user configuration.
 * Config is persisted at: ~/.nuka/plugins/<name>/.userconfig.json
 *
 * This module is the public 4b-compatible API. Internally it now reads
 * through `optionsStorage` so both layers share the same underlying file.
 * All callers see identical behavior — the only new capability is that
 * optionsStorage also handles marketplace-defaults and effectiveValues().
 */
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { LoadedPlugin } from './manifest'
import { readOptions } from './optionsStorage'

export function getUserConfigPath(home: string, pluginName: string): string {
  return join(home, '.nuka', 'plugins', pluginName, '.userconfig.json')
}

/**
 * Read persisted user config for a plugin.
 * Returns null if the file does not exist or cannot be parsed.
 *
 * Reads through optionsStorage.readOptions() for consistency; returns only
 * the userValues layer (null when empty, matching the 4b contract).
 */
export async function readUserConfig(
  home: string,
  pluginName: string,
): Promise<Record<string, unknown> | null> {
  const opts = await readOptions(home, pluginName)
  const vals = opts.userValues
  if (Object.keys(vals).length === 0) return null
  return vals
}

/**
 * Persist user config for a plugin (full replace — 4b-compatible).
 * Creates the plugin directory if it doesn't exist.
 *
 * Note: this is a full write, not a merge. Use optionsStorage.writeUserValues()
 * for partial/merged updates.
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
