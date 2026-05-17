// src/core/awaySummary/idleHook.ts
//
// Iter RR — runtime wiring that connects `startIdleWatcher` (generic
// timer-driven away/return detector) to `createAwaySummaryRunner`
// (LLM-backed recap generator).
//
// The hook owns three responsibilities:
//
//   1. Read the current session's transcript at trigger time (so the
//      recap reflects state at *return*, not at hook-construction).
//   2. Bound the recap call with a per-trigger AbortController so a
//      slow model call never blocks subsequent triggers.
//   3. Swallow failures from the runner so a flaky model never crashes
//      the idle loop. Errors are routed through the injected `log`
//      sink (default: `process.stderr.write`) so the surrounding ink
//      render is not corrupted.
//
// Why a separate module (vs. inlining in cli.tsx)?
//   • The wiring has enough policy (threshold, transcript snapshot,
//     abort-on-stop, error containment) to deserve its own unit test
//     surface — `cli.tsx` is hard to test in isolation.
//   • Future iters can swap the recap-delivery channel (banner / TUI
//     notice / log) without touching the idle-detector contract.
//
// What is intentionally NOT here:
//   • TUI poke() integration — input-edge calls to `poke()` happen in
//     `src/tui/` (excluded from this iter's scope). Without `poke()`
//     wiring the watcher never marks the session as "away" → `onReturn`
//     never fires in production. The wiring infrastructure is landed
//     now; the TUI side is a follow-up iter.

import type { Message } from '../message/types'
import {
  startIdleWatcher,
  type IdleWatcherOpts,
} from '../recap/idleWatcher'
import type { AwaySummaryRunner } from './runner'
import type { AwaySummaryResult } from './summary'

/**
 * Default away threshold — 5 minutes of input silence before the
 * watcher arms `onAway`, after which the next `poke()` triggers the
 * recap. Tuned to match common "stepped away from keyboard" gaps
 * without firing during ordinary think-time.
 */
export const DEFAULT_IDLE_THRESHOLD_MS = 5 * 60 * 1000

/**
 * Signature the hook uses to fetch the live transcript at trigger
 * time. Returning an empty array makes the runner return `null`
 * (the recap module guards on transcript length).
 */
export type GetMessagesFn = () => readonly Message[]

/**
 * Signature for the recap-delivery sink. Default routes through
 * `process.stderr.write` so the message lands next to other CLI
 * diagnostics without competing with ink's stdout draws.
 */
export type RecapSinkFn = (line: string) => void

/**
 * Iter NNNN — structured recap event. The string `onRecap` sink remains
 * for stderr / log routing; this typed shape is what the TUI banner
 * subscribes to via `setOnRecapResult`. Includes the original
 * `AwaySummaryResult` fields plus the idle window in ms so the banner
 * can render "Away N min" without re-deriving it.
 */
export type AwayRecapEvent = {
  /** Capped recap text from `generateAwaySummary` (≤ 400 chars). */
  text: string
  /** Idle window that triggered this recap, in milliseconds. */
  idleMs: number
  /** Token usage attributed to the recap call. */
  tokensUsed: number
  /** Model id used for the recap call. */
  modelUsed: string
}

/**
 * Iter NNNN — subscribe to typed recap events. Returns an unsubscribe.
 * Multiple TUI surfaces can subscribe independently (e.g. banner +
 * future toast). The default-stderr `onRecap` sink is still invoked
 * alongside any subscribers.
 */
export type RecapResultListener = (event: AwayRecapEvent) => void

export type IdleAwaySummaryHookOpts = {
  /** Production runner produced by `createAwaySummaryRunner`. */
  runner: AwaySummaryRunner
  /** Live transcript accessor — called once per `onReturn` firing. */
  getMessages: GetMessagesFn
  /** Away threshold in milliseconds. Defaults to 5 minutes. */
  thresholdMs?: number
  /** Optional recap-delivery sink. Defaults to stderr. */
  onRecap?: RecapSinkFn
  /** Optional error sink. Defaults to stderr. */
  onError?: RecapSinkFn
}

export type IdleAwaySummaryHook = {
  /** Pulse on user input — same contract as `startIdleWatcher`. */
  poke: () => void
  /** Tear down the watcher and abort any in-flight recap. */
  stop: () => void
  /**
   * Iter NNNN — subscribe to typed recap events. Returns an
   * unsubscribe callback. Subscribers fire AFTER the string `onRecap`
   * sink so stderr logging is never delayed by a slow listener.
   */
  onRecapResult: (listener: RecapResultListener) => () => void
}

function defaultSink(line: string): void {
  process.stderr.write(`${line}\n`)
}

/**
 * Compose `startIdleWatcher` + `AwaySummaryRunner`. The returned
 * handle is the same shape as `startIdleWatcher`'s — callers wire
 * `poke()` to input events and `stop()` to session teardown.
 *
 * The recap result is routed to `onRecap`. The default sink writes
 * to `process.stderr` so it does not collide with the ink-rendered
 * TUI. TUI-banner integration is a follow-up.
 *
 * @example
 * ```ts
 * const hook = startIdleAwaySummaryHook({
 *   runner: createAwaySummaryRunner({ provider }),
 *   getMessages: () => sessions.active()?.messages ?? [],
 * })
 * // TODO: tui input → hook.poke()
 * process.on('exit', hook.stop)
 * ```
 */
export function startIdleAwaySummaryHook(
  opts: IdleAwaySummaryHookOpts,
): IdleAwaySummaryHook {
  if (!opts.runner) {
    throw new Error('startIdleAwaySummaryHook: opts.runner is required')
  }
  if (typeof opts.getMessages !== 'function') {
    throw new Error('startIdleAwaySummaryHook: opts.getMessages is required')
  }
  const thresholdMs = opts.thresholdMs ?? DEFAULT_IDLE_THRESHOLD_MS
  if (!Number.isFinite(thresholdMs) || thresholdMs <= 0) {
    throw new Error('startIdleAwaySummaryHook: thresholdMs must be a positive finite number')
  }
  const onRecap: RecapSinkFn = opts.onRecap ?? defaultSink
  const onError: RecapSinkFn = opts.onError ?? defaultSink

  // One AbortController per active recap. Replaced on each trigger so
  // a still-running call from a previous return-event is cancelled
  // before a new one starts, and `stop()` aborts whichever is current.
  let inflight: AbortController | null = null

  // Iter NNNN — typed-event subscribers. The string `onRecap` sink
  // continues to receive the formatted log line; listeners installed
  // via `onRecapResult` receive a structured AwayRecapEvent.
  // Listeners are fanned out synchronously after the string sink so a
  // throwing listener cannot corrupt the abort/inflight bookkeeping.
  const listeners = new Set<RecapResultListener>()

  const fireRecap = (idleMs: number): void => {
    // Abort any straggling previous call before spinning a new one.
    if (inflight) {
      inflight.abort()
      inflight = null
    }
    const messages = opts.getMessages()
    if (messages.length === 0) {
      // Nothing to summarize — skip the model call entirely.
      return
    }
    const ctrl = new AbortController()
    inflight = ctrl
    // Fire-and-forget — the idle loop must not block on the model.
    void (async () => {
      try {
        const result: AwaySummaryResult | null = await opts.runner({
          messages,
          signal: ctrl.signal,
        })
        if (ctrl.signal.aborted) return
        if (result && result.text) {
          const seconds = Math.round(idleMs / 1000)
          onRecap(`[awaySummary | back after ${seconds}s] ${result.text}`)
          // Iter NNNN — fan out the typed event AFTER the stderr sink so
          // a slow listener (e.g. a setState-then-rerender) does not
          // delay the diagnostic log. Listener throws are isolated so
          // one broken subscriber cannot stop the others from firing.
          const event: AwayRecapEvent = {
            text: result.text,
            idleMs,
            tokensUsed: result.tokensUsed,
            modelUsed: result.modelUsed,
          }
          for (const listener of listeners) {
            try {
              listener(event)
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              onError(`[awaySummary] listener failed: ${msg}`)
            }
          }
        }
      } catch (err) {
        if (ctrl.signal.aborted) return
        const msg = err instanceof Error ? err.message : String(err)
        onError(`[awaySummary] runner failed: ${msg}`)
      } finally {
        if (inflight === ctrl) inflight = null
      }
    })()
  }

  const watcherOpts: IdleWatcherOpts = {
    thresholdMs,
    onAway: () => {
      // No-op for now — the recap fires on return, not on going away.
      // Future iter could surface "the agent is away" to the TUI.
    },
    onReturn: (idleMs: number) => fireRecap(idleMs),
  }
  const watcher = startIdleWatcher(watcherOpts)

  return {
    poke: watcher.poke,
    stop: () => {
      if (inflight) {
        inflight.abort()
        inflight = null
      }
      watcher.stop()
      // Iter NNNN — drop listener refs so callers who keep a handle on
      // the hook after stop() don't pin React state by accident.
      listeners.clear()
    },
    onRecapResult: (listener: RecapResultListener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
