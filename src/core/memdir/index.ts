// src/core/memdir/index.ts
//
// Phase 7 §5.3 — MEMORY.md storage layer.
//
// Stable per-cwd directory under `~/.nuka/memory/<sha1(cwd)>/MEMORY.md` so
// the same project resolves to the same file across machines (assuming
// matching cwd). sha1 is enough — collision risk is irrelevant; we're not
// using it for security.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import {
  parseMemoryFile,
  formatMemoryFile,
  formatMemoryEntry,
  type MemoryEntry,
} from './parser'

export type { MemoryEntry } from './parser'

// Auxiliary primitives ported from upstream Nuka-Code's memdir (Issue #9).
// Surface them through the public memdir entrypoint so external callers
// (system prompt builders, future recall hooks) consume one canonical
// import path.
export {
  memoryAge,
  memoryAgeDays,
  memoryFreshnessNote,
  memoryFreshnessText,
} from './memoryAge'
export {
  formatMemoryManifest,
  scanMemoryFiles,
  type MemoryHeader,
} from './memoryScan'
export {
  MEMORY_TYPES,
  type MemoryType,
  parseMemoryType,
} from './memoryTypes'
export {
  findRelevantMemories,
  parseSelectedFilenames,
  type FindRelevantMemoriesOpts,
  type RelevantMemory,
} from './findRelevantMemories'

import {
  teamMemoryPath,
  teamMemoryDir,
  isTeamMemoryEnabled as isTeamMemoryEnabledForConfig,
  validateTeamMemKey,
  PathTraversalError,
} from './teamMemPaths'

// Re-export so external consumers import one canonical entrypoint.
export {
  teamMemoryPath,
  teamMemoryDir,
  validateTeamMemKey,
  PathTraversalError,
}
export const isTeamMemoryEnabled = isTeamMemoryEnabledForConfig

/** Resolve `~/.nuka/memory/<sha1(cwd)>/MEMORY.md`. */
export function memoryPath(cwd: string, home: string = os.homedir()): string {
  const hash = crypto.createHash('sha1').update(cwd).digest('hex')
  return path.join(home, '.nuka', 'memory', hash, 'MEMORY.md')
}

/** Load all entries for `cwd`. Returns `[]` if the file doesn't exist. */
export async function loadMemory(cwd: string, home?: string): Promise<MemoryEntry[]> {
  const file = memoryPath(cwd, home)
  let raw: string
  try {
    raw = await fs.readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  return parseMemoryFile(raw)
}

/**
 * Append one entry. Atomic via tmp+rename. Creates the parent directory
 * on demand. Concurrent appends from the same process serialize through
 * `loadMemory + writeAll` — safe because Phase 7 only writes at session
 * end (never during a turn).
 */
export async function appendMemory(cwd: string, entry: MemoryEntry, home?: string): Promise<void> {
  const file = memoryPath(cwd, home)
  await fs.mkdir(path.dirname(file), { recursive: true })
  let existing = ''
  try {
    existing = await fs.readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  const block = formatMemoryEntry(entry)
  const next = existing.trim().length === 0
    ? block
    : `${existing.replace(/\n+$/, '')}\n\n${block}`
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  await fs.writeFile(tmp, next, 'utf8')
  await fs.rename(tmp, file)
}

/** Replace the entire file contents (used by `/memdir clear`). */
export async function writeAllMemory(cwd: string, entries: readonly MemoryEntry[], home?: string): Promise<void> {
  const file = memoryPath(cwd, home)
  await fs.mkdir(path.dirname(file), { recursive: true })
  const text = formatMemoryFile(entries)
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  await fs.writeFile(tmp, text, 'utf8')
  await fs.rename(tmp, file)
}

/** Remove the file entirely (used by `/memdir clear`). */
export async function clearMemory(cwd: string, home?: string): Promise<void> {
  const file = memoryPath(cwd, home)
  await fs.rm(file, { force: true })
}

/**
 * Load team-memory entries for `<teamId, cwd>`. Returns `[]` on ENOENT
 * (most common state — a brand-new team hasn't written anything yet)
 * and rethrows any other I/O error. Parsing uses the SAME parser as
 * per-cwd memory because the on-disk format is identical; only the
 * directory differs.
 */
export async function loadTeamMemory(
  teamId: string,
  cwd: string,
  home?: string,
): Promise<MemoryEntry[]> {
  const file = teamMemoryPath(teamId, cwd, home)
  let raw: string
  try {
    raw = await fs.readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  return parseMemoryFile(raw)
}
