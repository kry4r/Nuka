// src/core/cron/store.ts
//
// Cron task registry. Default mode is in-memory only (session-scoped) —
// tasks live in this process and die when the CLI exits.
//
// Pass `persistPath` to the constructor (or call `getCronStore({ persistPath })`)
// to enable DURABLE MODE. In durable mode the store still accepts
// session-only tasks (those whose `durable: false`); only tasks added with
// `durable: true` are flushed to the file. The on-disk shape is therefore
// the subset of jobs the model explicitly asked to persist.
//
// Use {@link loadPersistedCronJobs} once at agent startup to rehydrate the
// store from a prior session — those rehydrated jobs come back with
// `durable: true`, so any later mutation re-writes them.
//
// Each task is identified by a short opaque ID. The store is responsible
// for ID generation so the tools don't need to think about uniqueness.

import { randomUUID } from 'node:crypto'
import {
  cronToHuman,
  nextCronRunMs,
  parseCronExpression,
} from './parser'
import { defaultCronPath, writeCronFile } from './persist'

export type CronTask = {
  /** Opaque short ID (8 hex chars). */
  id: string
  /** Validated 5-field cron expression (local time). */
  cron: string
  /** Prompt body to fire at each match. */
  prompt: string
  /** Epoch ms when the task was created. */
  createdAt: number
  /**
   * When true the task reschedules after firing; when false it auto-deletes
   * after the first match (one-shot reminder).
   */
  recurring: boolean
  /**
   * When true and the store is in durable mode, the task is written to
   * `persistPath` on every mutation and survives restarts. When false the
   * task is session-only (the default — matches the original Iter A
   * behavior). On a non-durable store this flag must be false; the tool
   * layer surfaces a clear error otherwise.
   */
  durable: boolean
  /**
   * Epoch ms of the most recent successful fire, OR `undefined` if the
   * task has never fired in any session. The scheduler uses this (falling
   * back to `createdAt`) as the anchor for `nextCronRunMs`, so a recurring
   * task fires on schedule instead of every tick after the first match.
   *
   * On disk this field is OPTIONAL — old v1 files that predate Iter HHHH
   * simply omit it and load with `lastFiredAt: undefined`, preserving the
   * historical createdAt-anchor behavior (see `bootRehydrate`). New files
   * round-trip the field, which means a fire-then-restart no longer
   * triggers an immediate re-fire window.
   */
  lastFiredAt?: number
}

export type CronStoreOptions = {
  /**
   * When set, the store atomically writes its durable tasks to this path
   * on every mutation. Omit (or pass undefined) for in-memory only.
   */
  persistPath?: string
}

export class CronStore {
  private tasks = new Map<string, CronTask>()
  /** Set iff durable mode is on. */
  private readonly persistPath?: string
  /**
   * Outstanding persist write. Mutations chain off this so concurrent
   * `add()` calls serialise into a sequence of full-file writes — the
   * last write reflects the final state and earlier writers never see
   * a torn file. (rename is atomic per POSIX, but we still want write
   * ordering to match call ordering.)
   */
  private pendingWrite: Promise<void> = Promise.resolve()

  /** Maximum simultaneous jobs. The model gets a friendly error past this. */
  static readonly MAX_JOBS = 50

  constructor(opts: CronStoreOptions = {}) {
    this.persistPath = opts.persistPath
  }

  /** Returns true iff the store is configured to flush to disk. */
  isDurable(): boolean {
    return this.persistPath !== undefined
  }

  /** Path the store writes to, if durable; undefined otherwise. */
  getPersistPath(): string | undefined {
    return this.persistPath
  }

  list(): CronTask[] {
    return [...this.tasks.values()]
  }

  /** Only the durable tasks — what would be visible on disk. */
  listDurable(): CronTask[] {
    return this.list().filter((t) => t.durable)
  }

  get(id: string): CronTask | undefined {
    return this.tasks.get(id)
  }

  size(): number {
    return this.tasks.size
  }

  add(input: {
    cron: string
    prompt: string
    recurring: boolean
    now?: number
    /** Override ID generation (used by {@link hydrate} to preserve disk IDs). */
    id?: string
    /** Default false — session-only. true requires durable mode. */
    durable?: boolean
    /**
     * Optional fire history anchor — used by {@link hydrate} to carry the
     * persisted `lastFiredAt` through to the in-memory task. Production
     * `add` paths (CronCreate tool, test helpers) leave this undefined;
     * the scheduler advances it via {@link updateLastFiredAt} after a fire.
     */
    lastFiredAt?: number
  }): CronTask {
    const durable = input.durable ?? false
    if (durable && !this.isDurable()) {
      throw new Error(
        'CronStore.add: durable=true requires the store to be configured with persistPath',
      )
    }
    const id = input.id ?? randomUUID().replace(/-/g, '').slice(0, 8)
    const task: CronTask = {
      id,
      cron: input.cron,
      prompt: input.prompt,
      createdAt: input.now ?? Date.now(),
      recurring: input.recurring,
      durable,
      lastFiredAt: input.lastFiredAt,
    }
    this.tasks.set(id, task)
    if (durable) this.schedulePersist()
    return task
  }

  remove(id: string): boolean {
    const existing = this.tasks.get(id)
    const removed = this.tasks.delete(id)
    if (removed && existing?.durable) this.schedulePersist()
    return removed
  }

  clear(): void {
    const hadDurable = this.list().some((t) => t.durable)
    this.tasks.clear()
    if (hadDurable) this.schedulePersist()
  }

  /**
   * Drop-in load of previously persisted jobs. Used by the rehydrate-on-
   * startup helper — preserves the original IDs and createdAt so a restart
   * looks identical to the prior session from the model's perspective.
   * Loaded tasks come back with `durable: true` so future mutations keep
   * them on disk. Does NOT trigger a persist write itself (we're loading
   * from the same file we'd be writing to, that would be silly).
   *
   * Accepts the persisted shape (no `durable` flag) or full CronTasks —
   * either way the result is marked durable.
   */
  hydrate(tasks: readonly Omit<CronTask, 'durable'>[]): void {
    for (const t of tasks) {
      // Last-writer-wins on duplicate ids; consistent with Map semantics.
      this.tasks.set(t.id, {
        id: t.id,
        cron: t.cron,
        prompt: t.prompt,
        createdAt: t.createdAt,
        recurring: t.recurring,
        durable: true,
        // Optional in the persisted shape (added in Iter HHHH). Old v1
        // files load with `undefined` here, which makes the scheduler
        // fall back to the createdAt anchor — exact same behavior as
        // before this field existed.
        lastFiredAt: t.lastFiredAt,
      })
    }
  }

  /**
   * Record a successful fire timestamp on the task. Called by the
   * scheduler after each fire. Mutates the in-memory task and, for
   * durable tasks, schedules a flush so the anchor survives a restart
   * (Iter HHHH).
   *
   * Returns `false` if the task is unknown (e.g. a one-shot already
   * removed by the same tick), so the scheduler can no-op without
   * raising. Returns `true` on a successful update.
   *
   * The write is intentionally non-awaited from the caller's
   * perspective — the next tick is 30s away by default, so a single
   * file rename per fire is well below any user-perceptible latency
   * budget. Callers that need to observe the on-disk state can call
   * {@link flush} the same way they do for other durable mutations.
   */
  updateLastFiredAt(id: string, ts: number): boolean {
    const existing = this.tasks.get(id)
    if (!existing) return false
    existing.lastFiredAt = ts
    if (existing.durable) this.schedulePersist()
    return true
  }

  /**
   * Wait for any pending durable write to finish. Tests use this to
   * observe the on-disk state after a mutation; runtime callers don't
   * need to await — the next mutation will queue behind this one.
   */
  async flush(): Promise<void> {
    await this.pendingWrite
  }

  private schedulePersist(): void {
    if (this.persistPath === undefined) return
    const target = this.persistPath
    const snapshot = this.listDurable()
    this.pendingWrite = this.pendingWrite
      .catch(() => {})
      .then(() => writeCronFile(target, snapshot))
  }
}

/**
 * Shared singleton so `make*` tool factories from different call sites all
 * agree on the same registry. Test code can opt out via `createCronStore()`.
 *
 * The first caller wins: passing `persistPath` to a later `getCronStore()`
 * call has no effect once the singleton is created. Wiring code should
 * decide durability once, at startup.
 */
let sharedStore: CronStore | undefined

export function getCronStore(opts?: CronStoreOptions): CronStore {
  if (!sharedStore) sharedStore = new CronStore(opts)
  return sharedStore
}

export function createCronStore(opts?: CronStoreOptions): CronStore {
  return new CronStore(opts)
}

/** Test-only: reset the shared singleton. Not used in production code. */
export function __resetCronStoreSingletonForTests(): void {
  sharedStore = undefined
}

/**
 * Sentinel used by tests / docs. Re-exported here so callers don't import the
 * parser directly when all they need is validation + human-pretty formatting.
 */
export { parseCronExpression, nextCronRunMs, cronToHuman, defaultCronPath }
