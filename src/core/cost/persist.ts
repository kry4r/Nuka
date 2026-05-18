// src/core/cost/persist.ts
//
// Phase 7 §5.2 persistence layer for {@link CostTracker}.
//
// On disk shape (`~/.nuka/cost.json`):
//   { "version": 1, "entries": CostEntry[] }
//
// - Atomic writes: marshal to a sibling tmp file, fsync, then rename.
//   Crashes during write leave the previous file intact.
// - Cap at MAX_ENTRIES, dropping oldest by `ts`. Bounds the file size and
//   the cost of every aggregate scan.
// - Schema is forward-tolerant: unknown future versions parse to an empty
//   list (we'd rather lose stats than crash the CLI on startup).

import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { CostEntry } from './tracker'

export const MAX_ENTRIES = 10_000
const SCHEMA_VERSION = 1

type FileV1 = {
  version: 1
  entries: CostEntry[]
}

/** Default location: `~/.nuka/cost.json`. */
export function defaultCostPath(home: string = os.homedir()): string {
  return path.join(home, '.nuka', 'cost.json')
}

/**
 * Read the cost file. Returns `[]` if the file is missing, malformed, or
 * declares a schema version we don't understand.
 */
export async function readCostFile(filePath: string): Promise<CostEntry[]> {
  let raw: string
  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== 'object') return []
  const obj = parsed as Partial<FileV1>
  if (obj.version !== SCHEMA_VERSION) return []
  if (!Array.isArray(obj.entries)) return []
  // Trust on first read; the tracker tolerates extra fields and bad numbers
  // are clamped on `record`. We only need shape sanity here.
  const out: CostEntry[] = []
  for (const e of obj.entries) {
    if (!e || typeof e !== 'object') continue
    const c = e as Partial<CostEntry>
    if (typeof c.model !== 'string' || typeof c.sessionId !== 'string') continue
    if (typeof c.ts !== 'number') continue
    out.push({
      model: c.model,
      sessionId: c.sessionId,
      ts: c.ts,
      inputTokens: typeof c.inputTokens === 'number' ? c.inputTokens : 0,
      outputTokens: typeof c.outputTokens === 'number' ? c.outputTokens : 0,
      cacheCreateTokens: typeof c.cacheCreateTokens === 'number' ? c.cacheCreateTokens : 0,
      cacheReadTokens: typeof c.cacheReadTokens === 'number' ? c.cacheReadTokens : 0,
    })
  }
  return out
}

/**
 * Atomically write `entries` to `filePath`. Caps the entry count at
 * {@link MAX_ENTRIES} by dropping the oldest by `ts`.
 */
export async function writeCostFile(
  filePath: string,
  entries: readonly CostEntry[],
): Promise<void> {
  const capped = capEntries(entries)
  const payload: FileV1 = { version: SCHEMA_VERSION, entries: capped }
  const dir = path.dirname(filePath)
  await fs.mkdir(dir, { recursive: true })
  // Use a per-process tmp suffix so concurrent writers don't clobber each
  // other's tmp; rename is atomic per POSIX.
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`
  await fs.writeFile(tmp, JSON.stringify(payload), 'utf8')
  try {
    await fs.rename(tmp, filePath)
  } catch (err) {
    // Best-effort cleanup of the tmp file when rename fails.
    await fs.rm(tmp, { force: true }).catch(() => {})
    throw err
  }
}

/** Return the most recent {@link MAX_ENTRIES} entries, sorted oldest-first. */
export function capEntries(entries: readonly CostEntry[]): CostEntry[] {
  if (entries.length <= MAX_ENTRIES) return entries.slice()
  // Keep the newest MAX_ENTRIES by ts.
  const sorted = entries.slice().sort((a, b) => a.ts - b.ts)
  return sorted.slice(sorted.length - MAX_ENTRIES)
}

// Re-export of the daily-totals helpers so consumers can import the whole
// cost persistence surface from one location (matches `defaultCostPath`).
export { defaultCostHistoryPath } from './costHistory'
