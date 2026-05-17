// src/tui/hooks/useIdlePoke.ts
//
// Iter MMMM — TUI side of the awaySummary idleWatcher wiring.
//
// cli.tsx constructs an `IdleAwaySummaryHook` (Iter RR) whose `poke()`
// method resets the underlying `startIdleWatcher` timer. Without anyone
// calling `poke()`, the watcher never marks the session as "away" and
// `onReturn` never fires in production — i.e. the awaySummary feature
// is effectively dead until the TUI reports user input.
//
// This hook is the smallest possible bridge between React/ink input
// handlers and that `poke()` method. It returns a stable callback so
// callers (PromptInput key handler, App-level useInput, etc.) can call
// it on every keystroke or submit without churning effect deps.
//
// Why a hook rather than passing `poke` directly?
//   1. The watcher may be absent (no provider configured → no awaySummary
//      runner → no hook). The component-side code should not have to
//      branch every call site; a no-op when the watcher is undefined
//      keeps the input handler one-liner.
//   2. `useCallback` over the watcher reference gives a stable function
//      identity across re-renders, so it can be safely listed in
//      `useEffect` / `useMemo` dependency arrays. The watcher's own
//      `poke` is already stable (built once in cli.tsx), but the wrapper
//      we expose stays stable across renders even if a caller passes a
//      conditionally-undefined watcher.
//   3. Keeps the integration point easy to mock in tests — pass a stub
//      `{ poke: vi.fn() }` and assert the returned function calls it.
//
// The hook is intentionally NOT app-wide context: cli.tsx already
// threads the watcher via props, and a context would add a new global
// without saving meaningful wiring.

import { useCallback } from 'react'

/**
 * Minimal shape this hook needs from the watcher. We accept the wider
 * `IdleAwaySummaryHook` type (which also has `stop()`) without coupling
 * to it directly — anything with a `poke(): void` works, including
 * test stubs and future replacements.
 */
export type IdlePokeTarget = {
  poke: () => void
}

/**
 * Returns a stable function that pokes the idle watcher when present
 * and is a no-op otherwise. Safe to call on every keystroke; the
 * underlying `poke()` is O(1) (it stores `Date.now()` and toggles a
 * boolean — see `src/core/recap/idleWatcher.ts`).
 *
 * @example
 * ```tsx
 * const pokeIdle = useIdlePoke(props.idleHook)
 * useInput((input) => {
 *   pokeIdle()
 *   // ... rest of handler
 * })
 * ```
 */
export function useIdlePoke(
  target: IdlePokeTarget | undefined | null,
): () => void {
  return useCallback(() => {
    target?.poke()
  }, [target])
}
