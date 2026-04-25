// src/core/rewind/checkpoint.ts
//
// Phase 8 §4.3 — file checkpointing (scaffolding).
//
// When `config.rewind.fileCheckpointing === true`, the agent loop calls
// `captureFileSnapshot(path)` after each successful Write/Edit tool run
// (see src/core/agent/loop.ts). This module records a SHA1 digest of the
// file's pre-or-post content keyed by (turnId, absolutePath) — enough data
// for a future `restore()` to reconstruct the prior state via `git stash`
// + `git checkout`.
//
// The snapshot itself is deliberately minimal in this phase: we record the
// file's current content hash + bytes length so a later `restore` can
// detect drift. Actual file-content preservation is deferred until git
// integration lands — the default OFF path is a no-op.

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

export type FileSnapshot = {
  /** Absolute path of the file. */
  path: string
  /** SHA1 of the file contents at snapshot time. */
  sha1: string
  /** Byte length at snapshot time (0 if file was missing). */
  bytes: number
  /** Wall-clock millis when captured. */
  ts: number
}

export type TurnCheckpoint = {
  /** Opaque turn identifier — caller-supplied (typically the user-msg id). */
  turnId: string
  /** Snapshots keyed by absolute path (one per file touched in the turn). */
  files: Map<string, FileSnapshot>
}

/**
 * In-memory per-session checkpoint ring. The log holds the last
 * `maxTurns` turns in insertion order; older entries drop off.
 */
export class CheckpointLog {
  private turns: TurnCheckpoint[] = []
  private readonly maxTurns: number

  constructor(opts: { maxTurns?: number } = {}) {
    this.maxTurns = opts.maxTurns ?? 50
  }

  /** Get-or-create the checkpoint bucket for a turn. */
  beginTurn(turnId: string): TurnCheckpoint {
    const existing = this.turns.find(t => t.turnId === turnId)
    if (existing) return existing
    const fresh: TurnCheckpoint = { turnId, files: new Map() }
    this.turns.push(fresh)
    while (this.turns.length > this.maxTurns) this.turns.shift()
    return fresh
  }

  record(turnId: string, snap: FileSnapshot): void {
    this.beginTurn(turnId).files.set(snap.path, snap)
  }

  find(turnId: string): TurnCheckpoint | undefined {
    return this.turns.find(t => t.turnId === turnId)
  }

  list(): TurnCheckpoint[] {
    return [...this.turns]
  }
}

/**
 * Read `path` and return its SHA1+bytes snapshot. Missing files produce
 * a zero-byte snapshot with the hash of empty content.
 */
export async function captureFileSnapshot(filePath: string): Promise<FileSnapshot> {
  let content: Buffer
  try {
    content = await readFile(filePath)
  } catch {
    content = Buffer.alloc(0)
  }
  const sha1 = createHash('sha1').update(content).digest('hex')
  return { path: filePath, sha1, bytes: content.length, ts: Date.now() }
}

/**
 * Extract absolute-ish file paths from the input of a Write or Edit tool
 * call. Non-string paths are ignored. The loop calls this so we can keep
 * the snapshot plumbing alongside the existing Write/Edit plumbing
 * without widening the tool contract.
 */
export function filePathsFromToolInput(toolName: string, input: unknown): string[] {
  if (toolName !== 'Write' && toolName !== 'Edit') return []
  const inp = input as Record<string, unknown>
  const p = inp['path']
  return typeof p === 'string' && p.length > 0 ? [p] : []
}
