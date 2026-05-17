// src/core/cron/persist.ts
//
// Durable persistence layer for {@link CronStore}.
//
// On disk shape (`<cwd>/.nuka/scheduled_tasks.json` by default):
//   { "version": 1, "tasks": CronTask[] }
//
// Conventions follow `src/core/cost/persist.ts`:
//   - Atomic writes: marshal to a sibling tmp file (per-pid suffix), then
//     rename. POSIX rename is atomic — crashes during write leave the
//     previous file intact.
//   - Schema is forward-tolerant: unknown future versions parse to an empty
//     list. Same goes for corrupted/missing files. We'd rather lose the
//     schedule than crash the CLI on startup.
//   - Unknown task-level keys are dropped on read. Anything we don't know
//     how to honor isn't worth round-tripping.
//   - `lastFiredAt` (Iter HHHH) is OPTIONAL and additive — old v1 files
//     that predate the field load with `lastFiredAt: undefined`, which the
//     scheduler treats identically to "never fired" (anchor on createdAt).
//     No schema-version bump is needed because the schema is purely
//     additive at the task level.
//
// Path default mirrors Nuka-Code's PROJECT_CONFIG_DIR_NAME ('.nuka') +
// upstream's 'scheduled_tasks.json' basename so an existing project's
// schedule survives a switch between codebases.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { nextCronRunMs, parseCronExpression } from './parser'
import type { CronStore, CronTask } from './store'

export const CRON_SCHEMA_VERSION = 1

/** Relative location of the cron file inside a project's `.nuka/` dir. */
export const CRON_FILE_REL = path.join('.nuka', 'scheduled_tasks.json')

/**
 * On-disk shape — omits the runtime-only `durable` flag.
 *
 * Anything in the file is durable by definition; the flag is a property
 * of the in-memory task, not the persistent record. Keeping the file
 * shape narrow means {@link CronStore.hydrate} naturally reconstructs
 * `durable: true` without us having to round-trip it.
 */
export type PersistedCronTask = Omit<CronTask, 'durable'>

type FileV1 = {
  version: 1
  tasks: PersistedCronTask[]
}

/** Resolve the cron file for a given cwd. */
export function defaultCronPath(cwd: string = process.cwd()): string {
  return path.join(cwd, CRON_FILE_REL)
}

/**
 * Read and parse the cron file. Returns an empty list when:
 *   - the file is missing (ENOENT)
 *   - the file is unreadable JSON
 *   - the schema version is unknown
 *   - the `tasks` field is missing or not an array
 *   - the entire entry is structurally malformed
 *
 * Individual malformed task entries are dropped (silently — we treat a
 * single bad line the same way upstream does: skip and move on). Tasks
 * whose `cron` no longer parses are also dropped so a hand-edit can't
 * leave the scheduler holding an unrunnable job.
 */
export async function readCronFile(filePath: string): Promise<PersistedCronTask[]> {
  let raw: string
  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    // Other errors (EACCES, EISDIR, ...) — keep going with an empty list
    // rather than crashing the agent loop on a misconfigured workspace.
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== 'object') return []
  const obj = parsed as Partial<FileV1>
  if (obj.version !== CRON_SCHEMA_VERSION) return []
  if (!Array.isArray(obj.tasks)) return []
  const out: PersistedCronTask[] = []
  for (const t of obj.tasks) {
    if (!t || typeof t !== 'object') continue
    const c = t as Partial<PersistedCronTask>
    if (typeof c.id !== 'string' || c.id.length === 0) continue
    if (typeof c.cron !== 'string') continue
    if (typeof c.prompt !== 'string') continue
    if (typeof c.createdAt !== 'number') continue
    if (typeof c.recurring !== 'boolean') continue
    if (!parseCronExpression(c.cron)) continue
    // lastFiredAt is OPTIONAL (Iter HHHH). Old v1 files omit it; new
    // files include it. Accept a finite number or treat anything else
    // (missing, null, string, NaN) as "never fired" rather than fail
    // the whole row — matches the rest of this loader's forgiving
    // posture on hand-edited files.
    const lastFiredAt =
      typeof c.lastFiredAt === 'number' && Number.isFinite(c.lastFiredAt)
        ? c.lastFiredAt
        : undefined
    // Drop unknown keys; we only round-trip the documented schema.
    const entry: PersistedCronTask = {
      id: c.id,
      cron: c.cron,
      prompt: c.prompt,
      createdAt: c.createdAt,
      recurring: c.recurring,
    }
    if (lastFiredAt !== undefined) entry.lastFiredAt = lastFiredAt
    out.push(entry)
  }
  return out
}

/**
 * Atomically write `tasks` to `filePath`. Creates parent directories
 * on demand. Uses a per-pid tmp suffix so concurrent writers don't
 * clobber each other's staging files.
 */
export async function writeCronFile(
  filePath: string,
  tasks: readonly CronTask[],
): Promise<void> {
  const payload: FileV1 = {
    version: CRON_SCHEMA_VERSION,
    // Strip the runtime-only `durable` flag (and any other incidental
    // keys) so the on-disk shape matches the schema. `lastFiredAt` is
    // emitted only when present (Iter HHHH) so the file shape stays
    // tidy for the never-fired-yet common case.
    tasks: tasks.map((t) => {
      const out: PersistedCronTask = {
        id: t.id,
        cron: t.cron,
        prompt: t.prompt,
        createdAt: t.createdAt,
        recurring: t.recurring,
      }
      if (typeof t.lastFiredAt === 'number') {
        out.lastFiredAt = t.lastFiredAt
      }
      return out
    }),
  }
  const dir = path.dirname(filePath)
  await fs.mkdir(dir, { recursive: true })
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`
  await fs.writeFile(tmp, JSON.stringify(payload, null, 2) + '\n', 'utf8')
  try {
    await fs.rename(tmp, filePath)
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {})
    throw err
  }
}

/**
 * Convenience for agent-loop startup: read the file and return the jobs
 * ready to drop into a fresh {@link CronStore}. Pure read — does not
 * touch the in-memory store. The wiring iter calls this once before
 * the first scheduler tick.
 *
 * Returns `[]` on missing / corrupt files (see {@link readCronFile}).
 */
export async function loadPersistedCronJobs(filePath: string): Promise<PersistedCronTask[]> {
  return readCronFile(filePath)
}

/**
 * A task is "missed" when its next scheduled run is strictly in the past.
 * Surfaced to the user at startup. Works for both one-shot and recurring
 * tasks — a recurring task whose window passed while Nuka was down is
 * still "missed".
 *
 * Anchor selection (Iter HHHH):
 *   • Prefer the persisted `lastFiredAt` when present — that's the most
 *     recent fire we know about, and the next-run is what would have come
 *     after it. A task that fired 5 minutes before Nuka exited won't show
 *     as missed when the user restarts 10 seconds later.
 *   • Fall back to `createdAt` for tasks that never fired. Equivalent to
 *     the original Iter J behavior (matches upstream's never-fired-before
 *     branch).
 *
 * Ported from Nuka-Code/src/utils/cronTasks.ts::findMissedTasks.
 */
export function findMissedTasks(
  tasks: readonly PersistedCronTask[],
  nowMs: number,
): PersistedCronTask[] {
  return tasks.filter((t) => {
    const anchor = t.lastFiredAt ?? t.createdAt
    const next = nextCronRunMs(t.cron, anchor)
    return next !== null && next < nowMs
  })
}

/**
 * Result of a rehydrate-on-boot run. `loaded` is what landed in the store;
 * `missed` is the subset whose next-run is in the past. Callers surface
 * `missed` to the user (welcome notice, console warn, …).
 */
export type BootRehydrateResult = {
  path: string
  loaded: PersistedCronTask[]
  missed: PersistedCronTask[]
}

/**
 * One-call boot helper: read the persist file, hydrate the store, and
 * compute the missed-task list. Caller decides how (or whether) to surface
 * the missed tasks — this helper is silent on disk errors so a misconfigured
 * workspace never blocks CLI startup.
 *
 * Idempotent over a fresh store. Calling it twice would re-hydrate the
 * same IDs (last-writer-wins on the underlying Map). Production wiring
 * calls it exactly once, before any tool factory pulls the singleton.
 */
export async function bootRehydrate(opts: {
  store: CronStore
  path?: string
  now?: number
}): Promise<BootRehydrateResult> {
  const filePath = opts.path ?? defaultCronPath()
  const loaded = await loadPersistedCronJobs(filePath)
  opts.store.hydrate(loaded)
  const missed = findMissedTasks(loaded, opts.now ?? Date.now())
  return { path: filePath, loaded, missed }
}
