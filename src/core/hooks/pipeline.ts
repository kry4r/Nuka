// src/core/hooks/pipeline.ts
//
// Execution semantics for the in-process HookRegistry. Pure logic — no
// filesystem, no network, no UI deps. The registry exposes this as the
// internals of `invoke()`; callers normally don't import from here directly.
//
// Design notes (mirroring upstream Nuka-Code patterns):
//
// - Sequential, not parallel. Handlers within an event run one after another
//   so priority ordering is meaningful and `skip` decisions from earlier
//   handlers are visible to the caller before later ones run. (Upstream's
//   `Promise.allSettled` in AsyncHookRegistry parallelises distinct pending
//   shell processes; for in-process callbacks we mirror the per-event-loop
//   sequential ordering that runHooks already uses.)
//
// - Error isolation: each handler is wrapped in try/catch. A throw turns into
//   `outcome: 'error'` in the results array. Sibling handlers always run.
//
// - Abort handling: between handlers, we check `signal.aborted`. Once
//   aborted, all *remaining* handlers are recorded as `outcome: 'aborted'`
//   and returned alongside the partial results.

import type {
  HookContext,
  HookHandler,
  HookResult,
  InvocationResult,
  RegisteredHook,
} from './events'

/**
 * Ordered comparator used by the registry to sort handlers prior to dispatch.
 * Higher `priority` first; ties broken by `insertionOrder` (earlier first).
 *
 * Exposed for testing — callers should not need to import this directly.
 */
export function compareRegisteredHooks(a: RegisteredHook, b: RegisteredHook): number {
  if (a.priority !== b.priority) return b.priority - a.priority
  return a.insertionOrder - b.insertionOrder
}

/**
 * Run a single handler under the error-isolation envelope.
 *
 * Sync and async handlers are both supported — we wrap the result in
 * `Promise.resolve` so a thrown sync error and a rejected promise are
 * indistinguishable upstream.
 */
export async function runOneHandler(
  hook: RegisteredHook,
  context: HookContext,
): Promise<InvocationResult> {
  try {
    const out = await Promise.resolve<HookResult | void>(hook.handler(context))
    return {
      id: hook.id,
      event: hook.event,
      outcome: 'success',
      result: out ?? undefined,
    }
  } catch (err: unknown) {
    return {
      id: hook.id,
      event: hook.event,
      outcome: 'error',
      error: err instanceof Error ? err : new Error(String(err)),
    }
  }
}

/**
 * Run an ordered list of handlers under sequential / error-isolated /
 * abort-aware semantics. Returns one result entry per handler.
 *
 * The handlers list must already be sorted (typically via
 * `compareRegisteredHooks`). If `signal` is already aborted on entry, every
 * handler is recorded as `'aborted'`. If `signal` aborts mid-iteration, the
 * handler that was about to run (and every subsequent one) is recorded as
 * `'aborted'` and execution stops.
 */
export async function runPipeline(
  hooks: ReadonlyArray<RegisteredHook>,
  context: HookContext,
  signal?: AbortSignal,
): Promise<InvocationResult[]> {
  const results: InvocationResult[] = []

  for (let i = 0; i < hooks.length; i++) {
    const hook = hooks[i]!
    if (signal?.aborted) {
      results.push({ id: hook.id, event: hook.event, outcome: 'aborted' })
      continue
    }

    // Re-check aborted *after* each handler too, so a long-running handler
    // followed by an abort still surfaces remaining entries as 'aborted'.
    const ctx: HookContext = { ...context, signal }
    const res = await runOneHandler(hook, ctx)
    results.push(res)
  }

  return results
}

/**
 * Convenience: extract the first handler that returned `{ skip: true }` from a
 * results array. Useful for callers that want a single veto signal without
 * iterating themselves.
 */
export function firstSkip(results: ReadonlyArray<InvocationResult>): InvocationResult | undefined {
  return results.find(r => r.outcome === 'success' && r.result?.skip === true)
}
