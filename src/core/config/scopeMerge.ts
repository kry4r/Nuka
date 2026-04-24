// src/core/config/scopeMerge.ts
/**
 * Deep-merge with enterprise-lock semantics for the four-scope config cascade.
 */

export type ConfigScope = 'enterprise' | 'user' | 'project' | 'local'
export const SCOPE_ORDER: ConfigScope[] = ['enterprise', 'user', 'project', 'local']

/**
 * Convert a dot-path to an array of keys.
 * e.g. "providers.openai.apiKey" → ["providers", "openai", "apiKey"]
 */
function parseDotPath(dotPath: string): string[] {
  return dotPath.split('.')
}

/**
 * Check if a given path (as string array) is "locked" by any of the locked dot-paths.
 * A path is locked if it starts with a locked prefix or exactly matches one.
 */
function isLocked(pathParts: string[], lockedPaths: string[]): boolean {
  const current = pathParts.join('.')
  for (const locked of lockedPaths) {
    if (current === locked || current.startsWith(locked + '.')) {
      return true
    }
  }
  return false
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/**
 * Deep-merge `override` into `base`, respecting locked paths.
 * Mutates base in-place and records sources for each assigned key.
 *
 * @param base - The accumulated config (mutated in-place)
 * @param override - The new scope's config to layer on top
 * @param scope - Which scope is being applied
 * @param lockedPaths - Dot-paths that cannot be overridden
 * @param sources - Accumulated Record<dotPath, ConfigScope> (mutated in-place)
 * @param currentPath - Dot-path prefix for recursion (empty string at root)
 */
export function deepMergeWithLock(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
  scope: ConfigScope,
  lockedPaths: string[],
  sources: Record<string, ConfigScope>,
  currentPath = '',
): void {
  for (const [key, value] of Object.entries(override)) {
    const fullPath = currentPath ? `${currentPath}.${key}` : key
    const pathParts = parseDotPath(fullPath)

    if (isLocked(pathParts, lockedPaths)) {
      console.warn(
        `[config:scope] key '${fullPath}' is enterprise-locked; '${scope}' override dropped`,
      )
      continue
    }

    if (isPlainObject(value) && isPlainObject(base[key])) {
      // Both are plain objects — recurse
      deepMergeWithLock(
        base[key] as Record<string, unknown>,
        value,
        scope,
        lockedPaths,
        sources,
        fullPath,
      )
    } else {
      // Primitive, array, or base is not an object — last-wins
      base[key] = value
      sources[fullPath] = scope
    }
  }
}

/**
 * Collect all locked dot-paths from an enterprise config object.
 * The enterprise config may have a top-level `locked: string[]` field.
 */
export function extractLocked(enterpriseRaw: unknown): string[] {
  if (!isPlainObject(enterpriseRaw)) return []
  const locked = (enterpriseRaw as Record<string, unknown>)['locked']
  if (!Array.isArray(locked)) return []
  return locked.filter((v): v is string => typeof v === 'string')
}
