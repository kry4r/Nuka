/**
 * Plugin options storage — a generalization of the userConfig layer.
 *
 * Three layers of values, merged in priority order (lowest to highest):
 *   1. defaults         — declared in plugin manifest (or passed explicitly)
 *   2. marketplaceDefaults — optional overrides from marketplace metadata
 *   3. userValues       — user-written values from ~/.nuka/plugins/<name>/.userconfig.json
 *
 * effectiveValues() merges: defaults < marketplaceDefaults < userValues
 *
 * Backward compatibility:
 *   The existing userConfig.ts functions (`readUserConfig`, `writeUserConfig`) still
 *   work unchanged. `readOptions` / `writeUserValues` are a superset. Callers that
 *   only set userValues see identical behavior to the 4b path.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

export type PluginOptions = {
  defaults: Record<string, unknown>
  userValues: Record<string, unknown>
  marketplaceDefaults?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function userValuesPath(home: string, pluginName: string): string {
  return join(home, '.nuka', 'plugins', pluginName, '.userconfig.json')
}

function marketplaceDefaultsPath(home: string, pluginName: string): string {
  return join(home, '.nuka', 'plugins', pluginName, '.marketplace-defaults.json')
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function readJsonFile(path: string): Promise<Record<string, unknown> | null> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    return null
  }
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

async function writeJsonFile(path: string, data: Record<string, unknown>): Promise<void> {
  const dir = path.slice(0, path.lastIndexOf('/'))
  await mkdir(dir, { recursive: true })
  await writeFile(path, JSON.stringify(data, null, 2), 'utf8')
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read all three option layers for a plugin.
 *
 * @param home       - User home directory (e.g. os.homedir())
 * @param pluginName - Plugin name (kebab-case)
 * @param defaults   - Plugin-declared defaults (from manifest or caller)
 */
export async function readOptions(
  home: string,
  pluginName: string,
  defaults: Record<string, unknown> = {},
): Promise<PluginOptions> {
  const [userValues, marketplaceDefaults] = await Promise.all([
    readJsonFile(userValuesPath(home, pluginName)),
    readJsonFile(marketplaceDefaultsPath(home, pluginName)),
  ])

  return {
    defaults,
    userValues: userValues ?? {},
    marketplaceDefaults: marketplaceDefaults ?? undefined,
  }
}

/**
 * Write user-supplied values. Merges with any existing user values
 * (i.e. a partial write only updates the provided keys).
 */
export async function writeUserValues(
  home: string,
  pluginName: string,
  values: Record<string, unknown>,
): Promise<void> {
  const path = userValuesPath(home, pluginName)
  const existing = (await readJsonFile(path)) ?? {}
  const merged = { ...existing, ...values }
  await writeJsonFile(path, merged)
}

/**
 * Write marketplace-supplied defaults. Called by the marketplace layer
 * post-install (M4-install stream) — not directly by end-users.
 */
export async function writeMarketplaceDefaults(
  home: string,
  pluginName: string,
  values: Record<string, unknown>,
): Promise<void> {
  await writeJsonFile(marketplaceDefaultsPath(home, pluginName), values)
}

/**
 * Compute effective values: defaults < marketplaceDefaults < userValues.
 */
export function effectiveValues(opts: PluginOptions): Record<string, unknown> {
  return {
    ...opts.defaults,
    ...(opts.marketplaceDefaults ?? {}),
    ...opts.userValues,
  }
}
