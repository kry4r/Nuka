// src/core/planMode/planModeState.ts
//
// Iter YYY — first-pass plan-mode infrastructure.
//
// `PlanModeState` is a per-session bookkeeping object: it tracks whether
// the agent is currently in plan mode and remembers each plan the agent
// has exited with (most recent last). The state is intentionally
// minimal — enforcement (blocking Write/Edit/Bash in plan mode) lives
// in `PermissionChecker` via the `PermissionCall.mode === 'plan'` gate
// and is fed from `Session.mode`. This module owns the *signal* the
// agent emits via the EnterPlanMode / ExitPlanMode tools.
//
// Why split state out instead of stuffing it onto `Session`?
// - Plan history (`plans[]`) is plan-mode-specific and doesn't belong
//   in the generic Session shape.
// - The tools want a single dependency to inject (the same way
//   `RecentFiles` is the dep for `makeRecentFilesTool`).
// - cli.tsx can construct one `PlanModeState` at startup, pass it to
//   both tool factories, and (in a later iter) wire it into a slash
//   command or TUI badge without touching tool code.
//
// What this file does NOT do:
// - Toggle `Session.mode = 'plan'` directly — that's a side-effect we
//   externalise via the `subscribe()` listener API (Iter ZZZ). cli.tsx
//   installs one listener that translates `{type:'enter'}` /
//   `{type:'exit', plan}` events into `Session.mode` mutations and
//   `writePlan(cwd, ...)` calls; PermissionChecker already gates
//   Write/Edit/Bash when `Session.mode === 'plan'`. Keeping the
//   coupling at the listener boundary means this module stays
//   testable without dragging session / fs deps into it.
// - Persist plans to disk itself — `src/core/plan/state.ts` owns the
//   per-cwd plan file. The in-memory history below is a sibling concept
//   (call-by-call audit trail), not a replacement; cli.tsx's listener
//   bridges the two.
//
// Idempotency rules pinned by the tests:
//   - `enter()` on an already-active state is a no-op (still active,
//     no extra event emitted).
//   - `exit()` while not active still records the plan AND switches
//     into "inactive" (i.e. it tolerates being called without a prior
//     enter; the tool layer surfaces a hint, but the state stays sane).
//   - `reset()` clears both `inPlanMode` and `plans`.

/** A single plan entry recorded at the moment of `exit()`. */
export interface PlanEntry {
  /** epoch-ms of when `exit()` was called */
  ts: number
  /** the plan text passed to `exit()` */
  plan: string
}

/**
 * Iter ZZZ — events fired by `PlanModeState` whenever its lifecycle
 * changes. Listeners are notified AFTER the state mutation has settled
 * so `isActive()` already reflects the new value when they run.
 *
 *  - `enter` : `enter()` flipped the state to active. Fired only on a
 *              true transition (a no-op idempotent `enter()` does NOT
 *              re-emit, so subscribers don't double-fire Session.mode
 *              writes).
 *  - `exit`  : `exit(plan)` recorded a plan and flipped the state to
 *              inactive. The exit event carries the trimmed-source plan
 *              text the subscriber needs to persist.
 *  - `reset` : `reset()` cleared all state. Useful for tests / `/plan
 *              reset` to roll the session.mode flag back to normal.
 */
export type PlanModeEvent =
  | { type: 'enter' }
  | { type: 'exit'; plan: string; entry: PlanEntry }
  | { type: 'reset' }

/** Listener callback registered via `PlanModeState.subscribe`. */
export type PlanModeListener = (event: PlanModeEvent) => void

export class PlanModeState {
  private inPlanMode = false
  private plans: PlanEntry[] = []
  private readonly clock: () => number
  /**
   * Listeners registered via `subscribe()`. We use a Set so the same
   * function can be added and removed cleanly, and so the iteration
   * order during `emit()` is insertion-order (per ECMAScript spec for
   * Set iteration).
   */
  private readonly listeners = new Set<PlanModeListener>()

  /**
   * @param clock injectable epoch-ms clock; defaults to `Date.now`.
   *              Tests pass a deterministic clock to assert timestamps.
   */
  constructor(clock: () => number = Date.now) {
    this.clock = clock
  }

  /**
   * Register a listener for plan-mode lifecycle events. Returns an
   * unsubscribe function the caller can invoke to drop the listener.
   *
   * Idempotent: subscribing the same function twice is a no-op (Set
   * semantics); calling the returned unsubscribe more than once is also
   * safe.
   *
   * Exception safety: a throwing listener is logged via `console.error`
   * but does NOT abort the dispatch loop — other listeners still fire.
   */
  subscribe(listener: PlanModeListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Fire `event` to every registered listener. Listener exceptions are
   * caught + reported so one bad subscriber can't break the rest. Not
   * exported — called only from `enter()`, `exit()`, `reset()`.
   */
  private emit(event: PlanModeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (err) {
        // Surface to console but keep iterating — a buggy listener must
        // not block Session.mode propagation or other listeners.
        console.error('[planModeState] listener threw:', err)
      }
    }
  }

  /**
   * Mark the session as being in plan mode. Idempotent: calling this
   * when already active is a no-op (no new event, no side-effect).
   *
   * The `enter` event fires only on a true transition (inactive →
   * active) so subscribers don't double-write Session.mode.
   */
  enter(): void {
    if (this.inPlanMode) return
    this.inPlanMode = true
    this.emit({ type: 'enter' })
  }

  /**
   * Leave plan mode and record `plan` in the history with the current
   * clock timestamp. Safe to call when not currently active — the plan
   * is still recorded (a divergence from EnterPlanMode is a hint, not
   * an error). Throws on empty/whitespace-only plan text so callers
   * can't accidentally store nothing.
   *
   * Fires `{type:'exit', plan, entry}` AFTER the state mutation lands
   * so listeners see `isActive() === false` already.
   */
  exit(plan: string): PlanEntry {
    if (typeof plan !== 'string') {
      throw new TypeError('PlanModeState.exit: plan must be a string')
    }
    const trimmed = plan.trim()
    if (trimmed.length === 0) {
      throw new Error('PlanModeState.exit: plan must be a non-empty string')
    }
    const entry: PlanEntry = { ts: this.clock(), plan }
    this.plans.push(entry)
    this.inPlanMode = false
    this.emit({ type: 'exit', plan, entry: { ts: entry.ts, plan: entry.plan } })
    return entry
  }

  /** True iff the agent has called `enter()` more recently than `exit()` / `reset()`. */
  isActive(): boolean {
    return this.inPlanMode
  }

  /**
   * Most recent recorded plan, or `undefined` when none exists yet.
   * The returned object is a shallow copy so the caller can't mutate
   * the internal history accidentally.
   */
  latestPlan(): PlanEntry | undefined {
    if (this.plans.length === 0) return undefined
    const last = this.plans[this.plans.length - 1]!
    return { ts: last.ts, plan: last.plan }
  }

  /** Total number of plans recorded so far (across all enter/exit cycles). */
  get planCount(): number {
    return this.plans.length
  }

  /**
   * Read-only freshest-first snapshot of recorded plans. Caller may
   * iterate or `JSON.stringify` it but should not mutate; the returned
   * array is a fresh shallow clone to enforce that.
   */
  history(): PlanEntry[] {
    return this.plans.slice().reverse().map(e => ({ ts: e.ts, plan: e.plan }))
  }

  /**
   * Drop all state (active flag + plan history). Used by tests and
   * `/plan reset`. Always fires a `reset` event (even if the state was
   * already clean) so listeners can use it as a "force back to normal"
   * trigger; subscribers that only care about exit transitions can
   * simply ignore `reset` events.
   */
  reset(): void {
    this.inPlanMode = false
    this.plans = []
    this.emit({ type: 'reset' })
  }
}
