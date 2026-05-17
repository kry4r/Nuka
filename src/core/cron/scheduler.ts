// src/core/cron/scheduler.ts
//
// Practical Iter GGGG — REPL-side tick for the cron registry.
// Iter HHHH — fire history is now persisted via `CronStore.updateLastFiredAt`
// so a fire-then-restart no longer triggers an immediate re-fire window.
//
// The cron infrastructure shipped in iters A/D/J landed the registry, the
// parser, durable mode, and rehydrate-on-startup. What it explicitly did
// NOT include (per the TODO comment at `tools.ts:10-12`) is the actual
// fire-the-prompt scheduling tick: registered tasks sat in the store and
// never fired. This module closes that gap.
//
// Responsibilities:
//
//   1. Poll the registry every `intervalMs` (default 30s) to look for
//      tasks whose next scheduled run is `<= now`.
//   2. Invoke an injected `fire(taskId, task, firedAt)` callback for each
//      due task — the consumer decides what "fire" means (emit an event,
//      push into the agent input queue, log…). Keeping side-effects in
//      the callback means this module is policy-free and trivially
//      unit-testable.
//   3. Record successful fires via `registry.updateLastFiredAt(id, now)`
//      so the next-due computation anchors on the most recent fire
//      rather than `createdAt`. The registry is responsible for flushing
//      that timestamp to disk in durable mode — the scheduler is
//      agnostic to whether the store is persistent.
//   4. Delete one-shot tasks (`recurring: false`) after a successful fire
//      so they don't refire next tick. Recurring tasks stay in the store.
//   5. Prevent overlapping ticks — if a previous tick is still draining
//      (slow `fire`), the next interval is skipped. The contract is
//      "best-effort polling with a guaranteed lower-bound interval", not
//      "fire on the exact minute".
//   6. Contain errors. A `fire` throw is caught + reported via the
//      injected `onError` sink; one bad task never crashes the scheduler.
//
// Why a separate module (vs. inlining in cli.tsx)?
//   • Same rationale as `awaySummary/idleHook.ts` — enough policy
//     (tick gating, error containment, lastFiredAt bookkeeping) to
//     deserve its own unit-test surface.
//   • The CLI wiring is opt-in via the `NUKA_CRON_SCHEDULER=1` env var.
//     Defaulting to OFF means existing behaviour (no surprise periodic
//     activity in production) is preserved until callers explicitly
//     turn it on, while tests can still exercise the scheduler in
//     isolation via `tickNow()`.
//
// What is intentionally NOT here:
//   • Catch-up firing for jobs that should have fired multiple times
//     during a long tick gap — we fire each due task at most once per
//     tickNow() call. Standard cron semantics on Unix; matches user
//     expectations.

import { nextCronRunMs } from './parser'
import type { CronStore, CronTask } from './store'

/**
 * Default polling interval. 30 seconds matches a "reasonable lower bound
 * on cron granularity" without busy-looping. Cron's smallest unit is a
 * minute, so polling at half that gives us at most ~30s of latency
 * between a task becoming due and the scheduler noticing.
 */
export const DEFAULT_CRON_TICK_INTERVAL_MS = 30_000

/**
 * Callback invoked when a task is due. The scheduler is policy-free
 * about what firing means; the wiring site decides (event bus, queue
 * push, console log). Errors from `fire` are caught + reported via
 * `onError` and do not stop subsequent tasks or future ticks.
 */
export type CronFireFn = (
  taskId: string,
  task: CronTask,
  firedAt: number,
) => Promise<void> | void

/**
 * Signature for diagnostic-line sinks. Default routes through
 * `process.stderr.write` so messages don't compete with ink-rendered
 * TUI output. Mirrors `awaySummary/idleHook.ts`'s convention.
 */
export type CronLogFn = (line: string) => void

export type CronSchedulerOpts = {
  /** Registry being polled. Required. */
  registry: CronStore
  /** Per-due-task callback. Required. */
  fire: CronFireFn
  /** Clock injection for tests. Default `Date.now`. */
  clock?: () => number
  /** Poll interval in milliseconds. Default 30s. */
  intervalMs?: number
  /** Error sink. Default `process.stderr.write`. */
  onError?: CronLogFn
}

function defaultErrorSink(line: string): void {
  process.stderr.write(`${line}\n`)
}

/**
 * REPL-side cron tick. Construct, call `start()`, call `stop()` on
 * shutdown. Tests can drive deterministically via `tickNow()` without
 * ever calling `start()` — the scheduler does not require a live
 * `setInterval` to function.
 *
 * @example
 * ```ts
 * const scheduler = new CronScheduler({
 *   registry: cronStore,
 *   fire: async (id, task) => console.log(`[cron] firing ${id}: ${task.prompt}`),
 * })
 * scheduler.start()
 * process.on('SIGINT', () => scheduler.stop())
 * ```
 */
export class CronScheduler {
  private readonly registry: CronStore
  private readonly fire: CronFireFn
  private readonly clock: () => number
  private readonly intervalMs: number
  private readonly onError: CronLogFn
  private timer: ReturnType<typeof setInterval> | null = null
  /**
   * In-flight tick guard. When `true`, the next `setInterval` callback
   * is a no-op so a slow `fire` cannot pile up overlapping ticks.
   */
  private ticking = false

  constructor(opts: CronSchedulerOpts) {
    if (!opts.registry) {
      throw new Error('CronScheduler: opts.registry is required')
    }
    if (typeof opts.fire !== 'function') {
      throw new Error('CronScheduler: opts.fire is required')
    }
    const intervalMs = opts.intervalMs ?? DEFAULT_CRON_TICK_INTERVAL_MS
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new Error('CronScheduler: intervalMs must be a positive finite number')
    }
    this.registry = opts.registry
    this.fire = opts.fire
    this.clock = opts.clock ?? (() => Date.now())
    this.intervalMs = intervalMs
    this.onError = opts.onError ?? defaultErrorSink
  }

  /**
   * Begin polling. Idempotent — a second call while running is a no-op
   * (returns silently rather than throwing, because boot wiring may end
   * up calling start() from multiple paths in error-recovery edges).
   */
  start(): void {
    if (this.timer !== null) return
    this.timer = setInterval(() => {
      // Don't await — setInterval can't propagate the promise anyway,
      // and we explicitly want the next interval to find `ticking`
      // still `true` if this fire is slow.
      void this.tickNow().catch((err) => {
        // Defensive net: `tickNow` already swallows per-task errors,
        // but a bug in the gate logic itself would land here.
        const msg = err instanceof Error ? err.message : String(err)
        this.onError(`[nuka:cron] scheduler tick crashed: ${msg}`)
      })
    }, this.intervalMs)
    // Don't keep the event loop alive just for the cron poll —
    // Node should still be able to exit when the user is done.
    // Matches the posture of other long-lived timers in this codebase.
    if (typeof this.timer.unref === 'function') {
      this.timer.unref()
    }
  }

  /**
   * Stop polling. Idempotent — safe to call from multiple shutdown
   * hooks (`SIGINT` + `beforeExit`, for instance). Does NOT abort an
   * in-flight `fire`; that callback runs to completion. The scheduler
   * just stops scheduling new ticks.
   */
  stop(): void {
    if (this.timer === null) return
    clearInterval(this.timer)
    this.timer = null
  }

  /**
   * Run one tick synchronously (well — asynchronously, but the caller
   * gets the promise). Exposed for tests: drive the scheduler via
   * fake timers + direct `tickNow()` calls rather than waiting on a
   * real `setInterval`.
   *
   * Overlap-guarded: if a previous `tickNow()` is still draining,
   * this call is a no-op (logged as "skipped" via `onError` so it's
   * visible without polluting stdout).
   */
  async tickNow(): Promise<void> {
    if (this.ticking) {
      this.onError('[nuka:cron] tick skipped — previous tick still running')
      return
    }
    this.ticking = true
    try {
      const now = this.clock()
      // Snapshot the list once per tick so mutations from `fire`
      // callbacks (e.g. a fire that adds a follow-up task) don't
      // bleed into the current tick. The freshly-added task will
      // be considered on the NEXT tick.
      const snapshot = this.registry.list()
      for (const task of snapshot) {
        // Re-check membership in case a previous `fire` in this same
        // tick removed it (cascading one-shot deletion etc.).
        if (this.registry.get(task.id) === undefined) continue
        if (!this.isDue(task, now)) continue
        try {
          await this.fire(task.id, task, now)
          // Successful fire — advance the anchor on the registry so
          // the next due-check computes from `now` rather than the
          // original `createdAt`. In durable mode the registry flushes
          // this to disk (Iter HHHH), so a fire-then-restart no longer
          // re-fires the same window.
          //
          // For one-shot tasks the entry is harmless (the task is
          // removed below) but we still record it so the on-disk
          // file is a faithful log of fire history in case the
          // remove() races a crash.
          this.registry.updateLastFiredAt(task.id, now)
          if (!task.recurring) {
            // One-shot tasks auto-delete after firing. Match the
            // cron-spec contract documented in `CronTask.recurring`.
            this.registry.remove(task.id)
          }
        } catch (err) {
          // One bad task never crashes the scheduler. Log + continue.
          const msg = err instanceof Error ? err.message : String(err)
          this.onError(`[nuka:cron] fire failed for ${task.id}: ${msg}`)
        }
      }
    } finally {
      this.ticking = false
    }
  }

  /**
   * Test-only: read the persisted lastFiredAt anchor for a task.
   * Production code never needs this; tests use it to assert that the
   * anchor advances correctly after a fire.
   *
   * (Iter HHHH: previously read from an in-memory Map; now reads
   * straight off the task in the registry so the assertion exercises
   * the persisted field path.)
   */
  __getLastFiredAtForTests(taskId: string): number | undefined {
    return this.registry.get(taskId)?.lastFiredAt
  }

  /**
   * A task is due when its next scheduled run (anchored on the more
   * recent of `lastFiredAt` or `createdAt`) is `<= now`. Pure function
   * over `(task, now)` — the anchor lives on the task itself (set by
   * the registry's `updateLastFiredAt` and persisted to disk in durable
   * mode).
   */
  private isDue(task: CronTask, now: number): boolean {
    const anchor = task.lastFiredAt ?? task.createdAt
    const next = nextCronRunMs(task.cron, anchor)
    // `nextCronRunMs` returns `null` for an expression that matches
    // no calendar date in the next year. We can't fire it — treat as
    // not-due. (The tool layer rejects such expressions on creation,
    // so this is a belt-and-braces guard for hand-edited persist
    // files that somehow slip past the rehydrate-time `parseCronExpression`
    // check.)
    if (next === null) return false
    return next <= now
  }
}
