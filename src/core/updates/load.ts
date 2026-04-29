// src/core/updates/load.ts
//
// Phase 13 M2 — Load updates from ~/.nuka/updates.json.
//
// Schema (§4.1.1):
//   UpdateEntry = { version?: string; date?: string; title?: string; bullets?: string[] }
//   File root may be UpdateEntry[] OR { entries: UpdateEntry[] }
//
// Behaviour:
//   - Missing / unreadable file → []
//   - Malformed JSON → []
//   - Conforming array or { entries: [...] } → up to MAX_ENTRIES entries, each
//     with up to MAX_BULLETS bullets; long bullets are truncated to MAX_BULLET_LEN
//     characters with a trailing '…'.
//   - Never throws.

import fs from 'node:fs/promises'
import path from 'node:path'

export type UpdateEntry = {
  version?: string
  date?: string
  title?: string
  bullets?: string[]
}

export const MAX_ENTRIES = 6
export const MAX_BULLETS = 4
export const MAX_BULLET_LEN = 60

function updatesPath(home: string): string {
  return path.join(home, '.nuka', 'updates.json')
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + '\u2026' // '…'
}

function isEntry(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function parseEntry(raw: unknown): UpdateEntry {
  if (!isEntry(raw)) return {}
  const entry: UpdateEntry = {}
  if (typeof raw['version'] === 'string') entry.version = raw['version']
  if (typeof raw['date'] === 'string') entry.date = raw['date']
  if (typeof raw['title'] === 'string') entry.title = raw['title']
  if (Array.isArray(raw['bullets'])) {
    entry.bullets = (raw['bullets'] as unknown[])
      .filter(b => typeof b === 'string')
      .slice(0, MAX_BULLETS)
      .map(b => truncate(b as string, MAX_BULLET_LEN))
  }
  return entry
}

/**
 * Load and parse `~/.nuka/updates.json`. Returns `[]` on any error
 * (missing file, bad JSON, wrong shape). Never throws.
 */
export async function loadUpdates(home: string): Promise<UpdateEntry[]> {
  try {
    const text = await fs.readFile(updatesPath(home), 'utf8')
    const raw: unknown = JSON.parse(text)

    let entries: unknown[]
    if (Array.isArray(raw)) {
      entries = raw
    } else if (isEntry(raw) && Array.isArray(raw['entries'])) {
      entries = raw['entries'] as unknown[]
    } else {
      return []
    }

    return entries
      .slice(0, MAX_ENTRIES)
      .map(parseEntry)
  } catch {
    return []
  }
}
