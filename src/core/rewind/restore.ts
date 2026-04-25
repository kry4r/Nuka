// src/core/rewind/restore.ts
//
// Phase 8 §4.3 — restore stub.
//
// The production implementation will git-stash current changes and
// `git checkout <sha1>` each snapshotted file. That path is intentionally
// unimplemented here: the flag `config.rewind.fileCheckpointing` is OFF
// by default and restore is a documented no-op that reports the reason.
//
// Callers receive a discriminated result so they can surface a clear
// status message without branching on exceptions.

import type { CheckpointLog } from './checkpoint'

export type RestoreOk = { ok: true; restoredFiles: string[] }
export type RestoreSkip = { ok: false; reason: string }
export type RestoreResult = RestoreOk | RestoreSkip

export type RestoreConfig = {
  /** Mirror of `config.rewind.fileCheckpointing`. */
  fileCheckpointing: boolean
}

/**
 * Attempt to restore files snapshotted at or before `turnId`.
 *
 * With `fileCheckpointing === false` (the default) this is a guaranteed
 * no-op: it never touches the filesystem and returns a skip result. This
 * is the invariant that makes the scaffolding safe to merge early.
 *
 * With the flag on, the current implementation still declines — it
 * reports that the git-backed path is not yet wired. A follow-up PR will
 * replace this branch with an actual `git stash` + `git checkout` flow.
 */
export async function restore(
  log: CheckpointLog,
  turnId: string,
  config: RestoreConfig,
): Promise<RestoreResult> {
  if (!config.fileCheckpointing) {
    return { ok: false, reason: 'fileCheckpointing disabled' }
  }
  const turn = log.find(turnId)
  if (!turn) {
    return { ok: false, reason: `unknown turn: ${turnId}` }
  }
  // Not yet implemented — git-backed path is deferred; never destructive.
  return { ok: false, reason: 'git-backed restore not yet implemented' }
}
