/**
 * Plugin blocklist — fetch a remote blocklist and detect delisted plugins.
 *
 * Blocklist format (JSON):
 * {
 *   "blocked": [
 *     { "name": "bad-plugin" },
 *     { "name": "old-plugin", "reason": "security", "sinceVersion": "2.0" }
 *   ]
 * }
 *
 * sinceVersion semantics:
 *   If the installed version is OLDER than sinceVersion, the plugin is NOT delisted
 *   (the blocklist entry only applies starting from that version).
 *   e.g., installed=1.0, sinceVersion=2.0 → NOT delisted.
 *   e.g., installed=2.1, sinceVersion=2.0 → delisted.
 *
 * Non-numeric version segments (e.g. "1.0-alpha"):
 *   Be conservative — if any segment contains a non-numeric part, treat as a
 *   match (i.e., delist). This avoids false negatives on pre-release plugins.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'

export type BlocklistEntry = {
  name: string
  reason?: string
  sinceVersion?: string
}

export type Blocklist = {
  blocked: Array<BlocklistEntry>
}

export type DelistedPlugin = {
  name: string
  reason: string
}

// ---------------------------------------------------------------------------
// Minimal in-source semver comparison
// ---------------------------------------------------------------------------

/**
 * Parse a version string into a numeric tuple, one element per dot-segment.
 * Non-numeric segments are returned as NaN.
 * e.g. "1.2.3" → [1, 2, 3]; "1.0-alpha" → [1, NaN]
 */
function parseVersion(v: string): number[] {
  return v.split('.').map(seg => {
    const n = parseInt(seg, 10)
    // Check the segment is *purely* numeric (parseInt ignores trailing chars)
    return String(n) === seg ? n : NaN
  })
}

/**
 * Compare two version strings.
 * Returns:
 *  -1  if a < b
 *   0  if a === b
 *   1  if a > b
 *  NaN if either version contains any non-numeric segment
 *
 * NaN check is done up-front across all segments so that e.g. "1.0-alpha"
 * always returns NaN even if the first segment would otherwise resolve first.
 */
function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)

  // Up-front NaN check — any non-numeric segment anywhere → NaN
  if (pa.some(isNaN) || pb.some(isNaN)) return NaN

  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const ai = pa[i] ?? 0
    const bi = pb[i] ?? 0
    if (ai < bi) return -1
    if (ai > bi) return 1
  }
  return 0
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

/**
 * Fetch the blocklist from a URL and cache it locally.
 *
 * The injectable `fetchFn` defaults to `globalThis.fetch` so tests can provide
 * a lightweight mock without HTTP.
 */
export async function fetchBlocklist(
  sourceUrl: string,
  cachePath: string,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<Blocklist> {
  let raw: string
  try {
    const resp = await fetchFn(sourceUrl)
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} from ${sourceUrl}`)
    }
    raw = await resp.text()
  } catch (err: unknown) {
    // Fall back to cache if available
    try {
      raw = await readFile(cachePath, 'utf8')
      console.warn(
        `[blocklist] fetch failed (${(err as Error).message}), using cached copy`,
      )
    } catch {
      throw new Error(
        `[blocklist] fetch failed and no cache available: ${(err as Error).message}`,
      )
    }
  }

  // Write/update cache
  try {
    await mkdir(dirname(cachePath), { recursive: true })
    await writeFile(cachePath, raw, 'utf8')
  } catch {
    // Cache write failure is non-fatal
  }

  const data = JSON.parse(raw) as unknown
  return validateBlocklist(data)
}

function validateBlocklist(data: unknown): Blocklist {
  if (
    !data ||
    typeof data !== 'object' ||
    !Array.isArray((data as Record<string, unknown>)['blocked'])
  ) {
    throw new Error('[blocklist] invalid format: expected { blocked: [...] }')
  }
  const blocked = (data as Record<string, unknown>)['blocked'] as unknown[]
  return {
    blocked: blocked
      .filter(
        (e): e is BlocklistEntry =>
          !!e && typeof e === 'object' && typeof (e as Record<string, unknown>)['name'] === 'string',
      )
      .map(e => ({
        name: (e as Record<string, unknown>)['name'] as string,
        reason: (e as Record<string, unknown>)['reason'] as string | undefined,
        sinceVersion: (e as Record<string, unknown>)['sinceVersion'] as string | undefined,
      })),
  }
}

// ---------------------------------------------------------------------------
// Detect
// ---------------------------------------------------------------------------

/**
 * Given a list of installed plugins and a blocklist, return the plugins that
 * should be uninstalled.
 *
 * sinceVersion logic:
 *   - If entry has no sinceVersion → always delisted.
 *   - If installed version < sinceVersion → NOT delisted (old safe version).
 *   - If installed version >= sinceVersion → delisted.
 *   - If either version is non-numeric → be conservative → delisted.
 */
export function detectDelisted(
  installed: Array<{ name: string; version: string }>,
  blocklist: Blocklist,
): Array<DelistedPlugin> {
  const blockMap = new Map<string, BlocklistEntry>()
  for (const entry of blocklist.blocked) {
    blockMap.set(entry.name, entry)
  }

  const result: DelistedPlugin[] = []

  for (const plugin of installed) {
    const entry = blockMap.get(plugin.name)
    if (!entry) continue

    if (entry.sinceVersion !== undefined) {
      const cmp = compareVersions(plugin.version, entry.sinceVersion)
      if (!isNaN(cmp) && cmp < 0) {
        // installed version is strictly older than sinceVersion → not delisted
        continue
      }
      // cmp >= 0 or NaN (non-numeric segments) → delist (conservative)
    }

    result.push({
      name: plugin.name,
      reason: entry.reason ?? 'blocked by marketplace blocklist',
    })
  }

  return result
}
