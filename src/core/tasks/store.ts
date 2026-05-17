// src/core/tasks/store.ts
//
// Agent-facing TODO list store. This is the in-memory registry behind the
// TaskCreate / TaskList / TaskUpdate / TaskGet tools — the model's working
// memory for multi-step work it wants to track explicitly.
//
// Session-scoped only: tasks live in this process and die when the CLI
// exits. (The upstream Nuka-Code variant persists to disk per session and
// supports cross-process swarm coordination via lockfiles; that's out of
// scope here — Nuka has no shared swarm filesystem to coordinate over.)
//
// Mirrors the CronStore pattern from iter A: singleton via `getTaskStore()`
// for production wiring, and a factory `createTaskStore()` for tests that
// want isolated state.
//
// NOTE: there's a separate `src/core/tasks/` family (manager.ts, run-*.ts)
// for *background task execution*. This file is unrelated — it's about the
// model's TODO list, not background subprocess management. Naming chosen to
// match the brief and the upstream tool family (TaskCreate / TaskList / ...).

import { randomUUID } from 'node:crypto'

export const TASK_STATUSES = ['pending', 'in_progress', 'completed'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export type Task = {
  /** Opaque short ID (sequential numeric string). */
  id: string
  /** One-line title. */
  subject: string
  /** Longer-form description / requirements. */
  description: string
  /** Present-continuous spinner form, e.g. "Running tests". */
  activeForm?: string
  /** Agent that owns this task (free-form string set by the model). */
  owner?: string
  status: TaskStatus
  /** IDs of tasks this task is blocking. */
  blocks: string[]
  /** IDs of tasks that must complete before this one can start. */
  blockedBy: string[]
  /** Arbitrary tagging metadata. */
  metadata?: Record<string, unknown>
  /** Epoch ms when created. */
  createdAt: number
  /** Epoch ms when last updated. */
  updatedAt: number
}

export type TaskCreateInput = {
  subject: string
  description: string
  activeForm?: string
  owner?: string
  metadata?: Record<string, unknown>
  /** Optional explicit ID override (tests). */
  id?: string
  /** Optional explicit timestamp (tests). */
  now?: number
}

export type TaskUpdateInput = {
  subject?: string
  description?: string
  activeForm?: string
  status?: TaskStatus
  owner?: string | null
  /** IDs to append to `blocks` (deduped). */
  addBlocks?: string[]
  /** IDs to append to `blockedBy` (deduped). */
  addBlockedBy?: string[]
  /**
   * Metadata patch. `null` values delete the key; other values overwrite.
   * Missing keys are left alone.
   */
  metadata?: Record<string, unknown>
  /** Optional explicit timestamp (tests). */
  now?: number
}

export class TaskStore {
  private tasks = new Map<string, Task>()
  /** Monotonic counter so IDs are short, predictable strings ("1", "2", ...). */
  private nextSeq = 1
  /**
   * High-water mark for IDs (prevents reuse after clear()). Reset only
   * resets the visible task set, not the counter — surface to model is
   * stable IDs across the session.
   */
  private highWaterMark = 0

  /** Maximum simultaneous tasks. Friendly error to the model past this. */
  static readonly MAX_TASKS = 200

  list(): Task[] {
    return [...this.tasks.values()]
  }

  get(id: string): Task | undefined {
    return this.tasks.get(id)
  }

  size(): number {
    return this.tasks.size
  }

  add(input: TaskCreateInput): Task {
    if (this.tasks.size >= TaskStore.MAX_TASKS) {
      throw new Error(
        `TaskStore.add: too many tasks (max ${TaskStore.MAX_TASKS}). Resolve or delete some first.`,
      )
    }
    const now = input.now ?? Date.now()
    let id: string
    if (input.id !== undefined) {
      if (this.tasks.has(input.id)) {
        throw new Error(`TaskStore.add: duplicate id '${input.id}'`)
      }
      id = input.id
      // Keep nextSeq ahead of any explicit numeric ID we accepted.
      const asNum = Number.parseInt(input.id, 10)
      if (Number.isFinite(asNum) && asNum >= this.nextSeq) {
        this.nextSeq = asNum + 1
      }
    } else {
      // Pick a fresh sequential id that isn't already in use.
      id = String(this.nextSeq++)
      while (this.tasks.has(id)) {
        id = String(this.nextSeq++)
      }
    }
    const task: Task = {
      id,
      subject: input.subject,
      description: input.description,
      activeForm: input.activeForm,
      owner: input.owner,
      status: 'pending',
      blocks: [],
      blockedBy: [],
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
    }
    this.tasks.set(id, task)
    if (Number.isFinite(Number.parseInt(id, 10))) {
      const n = Number.parseInt(id, 10)
      if (n > this.highWaterMark) this.highWaterMark = n
    }
    return task
  }

  /**
   * Apply a partial update. Returns the updated task, or undefined if no
   * task with that id exists.
   *
   * `addBlocks` / `addBlockedBy` append (deduped); they do NOT replace.
   * Cross-references are kept consistent: adding `addBlocks: [X]` also adds
   * the reverse entry to X's `blockedBy`.
   *
   * Passing `owner: null` clears the owner. Use undefined to leave it alone.
   * Metadata keys with value `null` are deleted; other values overwrite.
   */
  update(id: string, patch: TaskUpdateInput): Task | undefined {
    const existing = this.tasks.get(id)
    if (!existing) return undefined

    const next: Task = {
      ...existing,
      updatedAt: patch.now ?? Date.now(),
    }

    if (patch.subject !== undefined) next.subject = patch.subject
    if (patch.description !== undefined) next.description = patch.description
    if (patch.activeForm !== undefined) next.activeForm = patch.activeForm
    if (patch.status !== undefined) next.status = patch.status

    if (patch.owner !== undefined) {
      next.owner = patch.owner === null ? undefined : patch.owner
    }

    if (patch.metadata !== undefined) {
      const merged: Record<string, unknown> = { ...(existing.metadata ?? {}) }
      for (const [key, value] of Object.entries(patch.metadata)) {
        if (value === null) {
          delete merged[key]
        } else {
          merged[key] = value
        }
      }
      next.metadata = Object.keys(merged).length === 0 ? undefined : merged
    }

    if (patch.addBlocks && patch.addBlocks.length > 0) {
      const set = new Set(next.blocks)
      for (const bid of patch.addBlocks) {
        if (bid === id) continue // No self-blocking.
        if (!this.tasks.has(bid)) continue // Drop dangling refs silently.
        set.add(bid)
      }
      next.blocks = [...set]
    }

    if (patch.addBlockedBy && patch.addBlockedBy.length > 0) {
      const set = new Set(next.blockedBy)
      for (const bid of patch.addBlockedBy) {
        if (bid === id) continue
        if (!this.tasks.has(bid)) continue
        set.add(bid)
      }
      next.blockedBy = [...set]
    }

    this.tasks.set(id, next)

    // Mirror cross-edges so the other side sees the symmetric relationship.
    if (patch.addBlocks) {
      for (const otherId of patch.addBlocks) {
        if (otherId === id) continue // No self-mirror.
        const other = this.tasks.get(otherId)
        if (!other) continue
        if (other.blockedBy.includes(id)) continue
        this.tasks.set(otherId, {
          ...other,
          blockedBy: [...other.blockedBy, id],
          updatedAt: next.updatedAt,
        })
      }
    }
    if (patch.addBlockedBy) {
      for (const otherId of patch.addBlockedBy) {
        if (otherId === id) continue
        const other = this.tasks.get(otherId)
        if (!other) continue
        if (other.blocks.includes(id)) continue
        this.tasks.set(otherId, {
          ...other,
          blocks: [...other.blocks, id],
          updatedAt: next.updatedAt,
        })
      }
    }

    return next
  }

  /**
   * Permanently remove a task. Also strips it from every other task's
   * `blocks` / `blockedBy` lists so the graph stays consistent.
   */
  remove(id: string): boolean {
    const existed = this.tasks.delete(id)
    if (!existed) return false
    for (const [otherId, other] of [...this.tasks.entries()]) {
      const blocks = other.blocks.filter((x) => x !== id)
      const blockedBy = other.blockedBy.filter((x) => x !== id)
      if (
        blocks.length !== other.blocks.length ||
        blockedBy.length !== other.blockedBy.length
      ) {
        this.tasks.set(otherId, { ...other, blocks, blockedBy })
      }
    }
    return true
  }

  /**
   * Wipe the visible task set. The sequential ID counter is NOT reset —
   * IDs remain monotonically increasing across the session so the model
   * never sees a reused number.
   */
  clear(): void {
    this.tasks.clear()
  }
}

/**
 * Shared singleton so `make*` tool factories from different call sites all
 * agree on the same registry. Test code uses `createTaskStore()` for
 * isolation.
 */
let sharedStore: TaskStore | undefined

export function getTaskStore(): TaskStore {
  if (!sharedStore) sharedStore = new TaskStore()
  return sharedStore
}

export function createTaskStore(): TaskStore {
  return new TaskStore()
}

/** Test-only: reset the shared singleton. */
export function __resetTaskStoreSingletonForTests(): void {
  sharedStore = undefined
}

/**
 * Generate a short opaque random ID. Currently unused by the store itself
 * (sequential numeric IDs are easier for the model to refer to in prose),
 * but exposed for callers that want non-sequential IDs.
 */
export function randomTaskId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 8)
}
