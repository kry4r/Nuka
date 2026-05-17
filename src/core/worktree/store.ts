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
    return this.worktrees.delete(id)
  }

  clear(): void {
    this.worktrees.clear()
  }
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
