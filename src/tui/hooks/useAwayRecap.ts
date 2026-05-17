// src/tui/hooks/useAwayRecap.ts
//
// Iter NNNN — TUI-side hook that surfaces the awaySummary recap as a
// dismissable banner. Subscribes to `IdleAwaySummaryHook.onRecapResult`
// (Iter NNNN extension to the idleHook surface) and exposes the most
// recent event plus a `dismiss()` to clear it.
//
// Behaviour rules:
//
//   1. When `target` is undefined / null, the hook is a no-op: `recap`
//      stays `null` forever and `dismiss` is a stable empty function.
//      Tests and offline-mode boots pass nothing and the App's banner
//      slot simply renders nothing.
//
//   2. Multiple recap events: latest-wins. The new event REPLACES any
//      currently-displayed recap. This matches how users actually
//      consume the banner — they care about the most recent return,
//      not a stack of older ones. Queuing was rejected as overengineering:
//      a queue would force the user to dismiss N times in a row after
//      coming back from a long meeting.
//
//   3. Dismissal: `dismiss()` clears the recap synchronously. Callers
//      typically wire it into PromptInput's `onUserInput` callback
//      (Iter MMMM) so the banner auto-clears on the first keystroke.
//      An auto-dismiss timeout is intentionally NOT implemented in
//      this hook — auto-dismissal couples display lifetime to wall
//      time, which is fragile under test (fake timers required); the
//      keystroke-dismiss is sufficient for the primary use case.
//
//   4. Unsubscribe on unmount: the listener is removed when the
//      component unmounts. The idleHook side defensively `listeners.clear()`s
//      on `stop()` too, so a process-wide stop won't leak React state.
//
// Why a hook (not Context)? The same reasoning as `useIdlePoke`:
// cli.tsx already threads the watcher via props. A context would add
// a new global without saving meaningful wiring.

import { useCallback, useEffect, useState } from 'react'
import type { AwayRecapEvent } from '../../core/awaySummary/idleHook'

/**
 * Minimum subset of `IdleAwaySummaryHook` this hook needs. We accept
 * the wider interface (it also has `poke()` / `stop()`) but type only
 * the subscription method so tests can pass a narrow stub.
 *
 * `onRecapResult` is intentionally optional: prior to Iter NNNN the
 * idleHook surface didn't expose subscription; older `idleHook` stubs
 * and contrived test doubles may still omit it. When absent, the hook
 * degrades to a permanent `recap: null` (same as `target: undefined`).
 */
export type AwayRecapTarget = {
  onRecapResult?: (listener: (event: AwayRecapEvent) => void) => () => void
}

export type UseAwayRecapResult = {
  /** Latest recap event, or `null` when nothing to display. */
  recap: AwayRecapEvent | null
  /** Clear the current recap. No-op when `recap` is already `null`. */
  dismiss: () => void
}

/**
 * Subscribe to typed recap events from the idle hook and expose the
 * latest one to render. The hook is stable: when target is missing,
 * `recap` stays `null` and `dismiss` is a no-op.
 *
 * @example
 * ```tsx
 * const { recap, dismiss } = useAwayRecap(props.idleHook)
 * if (recap) {
 *   return <AwayRecapBanner recap={recap} onDismiss={dismiss} />
 * }
 * ```
 */
export function useAwayRecap(
  target: AwayRecapTarget | undefined | null,
): UseAwayRecapResult {
  const [recap, setRecap] = useState<AwayRecapEvent | null>(null)

  useEffect(() => {
    if (!target || !target.onRecapResult) return
    // Latest-wins: every new event replaces whatever is on display.
    const unsubscribe = target.onRecapResult((event) => {
      setRecap(event)
    })
    return unsubscribe
  }, [target])

  // Stable identity so callers can pass `dismiss` into useEffect deps
  // (e.g. PromptInput.onUserInput) without churn. Uses functional
  // setState so we don't capture the current `recap` value.
  const dismiss = useCallback(() => {
    setRecap((prev) => (prev === null ? prev : null))
  }, [])

  return { recap, dismiss }
}
