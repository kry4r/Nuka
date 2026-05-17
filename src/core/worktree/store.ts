// src/core/worktree/store.ts
//
// Session-scoped registry of git worktrees that THIS process created via the
// EnterWorktree tool. Worktrees created outside this session (manual
// `git worktree add`, prior sessions) are intentionally NOT tracked here —
// the ExitWorktree tool refuses to operate on them as a safety gate.
//
// State lives only in memory. When the CLI exits, worktree directories on
// disk are left untouched; reclaiming them is the user's job.

import { randomUUID } from 'node:crypto'

export type WorktreeRecord = {
  /** Opaque short ID (8 hex chars) so tools can refer to a worktree by id. */
  id: string
  /** Absolute path on disk to the worktree. */
  path: string
  /** Branch name git checked out for the worktree, if known. */
  branch?: string
  /** The cwd the session was in at EnterWorktree time. */
  originalCwd: string
  /** Epoch ms when the worktree was registered. */
  createdAt: number
}

export class WorktreeStore {
  private worktrees = new Map<string, WorktreeRecord>()
  /**
   * P1 #6 — currently-active worktree. When set, the agent loop and
   * subagent dispatch resolve tool `ctx.cwd` to this record's `path`
   * instead of `process.cwd()`. EnterWorktree sets this on success;
   * ExitWorktree (via `remove`) clears it when the active record is the
   * one being removed. Only one worktree can be active at a time — this
   * is a flat pointer, not a stack.
   */
  private activeId: string | undefined

  /** Soft cap so an agent can't OOM by spinning up endless worktrees. */
  static readonly MAX_WORKTREES = 20

  list(): WorktreeRecord[] {
    return [...this.worktrees.values()]
  }

  get(id: string): WorktreeRecord | undefined {
    return this.worktrees.get(id)
  }

  getByPath(path: string): WorktreeRecord | undefined {
    return this.list().find((w) => w.path === path)
  }

  size(): number {
    return this.worktrees.size
  }

  add(input: {
    path: string
    branch?: string
    originalCwd: string
    now?: number
  }): WorktreeRecord {
    const id = randomUUID().replace(/-/g, '').slice(0, 8)
    const record: WorktreeRecord = {
      id,
      path: input.path,
      branch: input.branch,
      originalCwd: input.originalCwd,
      createdAt: input.now ?? Date.now(),
    }
    this.worktrees.set(id, record)
    return record
  }

  remove(id: string): boolean {
    if (id === this.activeId) this.activeId = undefined
    return this.worktrees.delete(id)
  }

  clear(): void {
    this.activeId = undefined
    this.worktrees.clear()
  }

  /**
   * Return the currently-active worktree, if any. The agent loop reads
   * this on every tool call to decide whether to override `ctx.cwd`.
   */
  getActive(): WorktreeRecord | undefined {
    if (!this.activeId) return undefined
    return this.worktrees.get(this.activeId)
  }

  /**
   * Mark a tracked worktree as active. Returns false if the id is not
   * tracked by this store (caller is expected to surface a tool error).
   */
  setActive(id: string): boolean {
    if (!this.worktrees.has(id)) return false
    this.activeId = id
    return true
  }

  /** Clear the active pointer without removing the record. */
  clearActive(): void {
    this.activeId = undefined
  }
}

/**
 * P1 #6 — resolve the cwd a tool should run in.
 *
 * Returns the active worktree's path when a store is provided AND has an
 * active record; otherwise falls back to `fallbackCwd` (typically
 * `process.cwd()`). Pure helper so the agent loop and subagent dispatch
 * share one resolution rule.
 *
 * The store is passed by reference so changes made by EnterWorktree /
 * ExitWorktree mid-turn take effect on the NEXT tool call. This is the
 * wiring contract that turns the `cwdOverride=...` marker into actual
 * behaviour.
 */
export function resolveToolCwd(
  store: WorktreeStore | undefined,
  fallbackCwd: string,
): string {
  return store?.getActive()?.path ?? fallbackCwd
}

/**
 * Singleton store for production use so factories and tools agree on the
 * same registry. Test code uses `createWorktreeStore()` for an isolated
 * fresh store.
 */
let sharedStore: WorktreeStore | undefined

export function getWorktreeStore(): WorktreeStore {
  if (!sharedStore) sharedStore = new WorktreeStore()
  return sharedStore
}

export function createWorktreeStore(): WorktreeStore {
  return new WorktreeStore()
}
