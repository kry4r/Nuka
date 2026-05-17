// src/core/hooks/lifecycle.ts
//
// Lifecycle hook fire helpers. Thin wrappers over `HookRegistry.invoke` for
// the broader-than-tool events: sessionStart / sessionEnd / promptSubmit /
// afterTurn / beforeAutoCompact.
//
// Why a separate helper file rather than inlining `registry.invoke(...)` at
// every call site:
//   - The same payload shape and signal-default policy applies to every
//     lifecycle fire. Centralising it keeps the agent loop / cli.tsx call
//     sites short and prevents drift (e.g. one site forgetting to set a
//     timeout signal).
//   - Tests for the wiring can target these helpers directly without
//     spinning up the full agent loop — the deep call sites just thread
//     the helper through.
//
// All helpers are best-effort: they never throw. The underlying
// `HookRegistry.invoke` already isolates per-handler errors into the
// returned `InvocationResult[]`; we catch any registry-level throw too
// (shouldn't happen, but cheap insurance) so a buggy registry can never
// crash the lifecycle path.

import type { HookRegistry } from './registry'
import type { InvocationResult } from './events'

/** Hard default timeout for any lifecycle fire. Generous because handlers
 *  may do non-trivial work (memory sync, telemetry flush, etc.). */
const DEFAULT_LIFECYCLE_TIMEOUT_MS = 5000

type FireOptions = {
  /** Optional caller-supplied signal. Combined with the lifecycle timeout. */
  signal?: AbortSignal
  /** Override the default 5s timeout. Pass 0 to disable the timeout entirely. */
  timeoutMs?: number
}

/**
 * Compose the caller's signal (if any) with a fresh timeout signal. Returns
 * `undefined` when both are absent so the registry treats it as no signal.
 */
function withTimeout(opts: FireOptions | undefined): AbortSignal | undefined {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_LIFECYCLE_TIMEOUT_MS
  const callerSignal = opts?.signal
  if (timeoutMs <= 0) return callerSignal
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  if (!callerSignal) return timeoutSignal
  // Node 20+ has AbortSignal.any; fall back to a manual race if absent.
  type AbortSignalCtor = typeof AbortSignal & { any?: (signals: AbortSignal[]) => AbortSignal }
  const ctor = AbortSignal as AbortSignalCtor
  if (typeof ctor.any === 'function') return ctor.any([callerSignal, timeoutSignal])
  const composite = new AbortController()
  const abort = (): void => composite.abort()
  callerSignal.addEventListener('abort', abort, { once: true })
  timeoutSignal.addEventListener('abort', abort, { once: true })
  return composite.signal
}

async function safeInvoke(
  registry: HookRegistry,
  event: Parameters<HookRegistry['invoke']>[0],
  payload: Readonly<Record<string, unknown>>,
  opts?: FireOptions,
): Promise<InvocationResult[]> {
  try {
    return await registry.invoke(event, { payload }, { signal: withTimeout(opts) })
  } catch {
    return []
  }
}

/**
 * Identifies the execution context the lifecycle event fired from.
 *
 * - `'main'`     — the primary interactive agent loop (cli.tsx / loop.ts).
 *                  Default when the field is omitted, for backward
 *                  compatibility with the JJJ wiring that did not populate it.
 * - `'subagent'` — fired from inside `dispatchAgent` (an isolated
 *                  sub-session). Handlers can filter on this to skip work
 *                  that only makes sense for the user-facing session
 *                  (e.g. UI banners, away-summary reminders).
 * - `'task'`     — reserved for the background `local_agent` task path.
 *                  Not yet wired; included so future iters don't have to
 *                  re-shape the type.
 */
export type LifecycleContext = 'main' | 'subagent' | 'task'

export type SessionStartPayload = Readonly<{
  sessionId: string
  providerId: string
  model: string
  cwd: string
  resumed: boolean
  /** Execution context. Omitted = `'main'` (legacy JJJ behaviour). */
  context?: LifecycleContext
  /** When `context === 'subagent'`, the fully qualified `<plugin>:<name>`. */
  agentName?: string
}>

export type SessionEndPayload = Readonly<{
  sessionId: string
  reason: 'sigint' | 'exit' | 'manual' | 'completed' | 'aborted'
  /** Execution context. Omitted = `'main'`. */
  context?: LifecycleContext
  /** When `context === 'subagent'`, the fully qualified `<plugin>:<name>`. */
  agentName?: string
}>

export type PromptSubmitPayload = Readonly<{
  sessionId: string
  text: string
  /** Execution context. Omitted = `'main'`. */
  context?: LifecycleContext
  /** When `context === 'subagent'`, the fully qualified `<plugin>:<name>`. */
  agentName?: string
}>

export type AfterTurnPayload = Readonly<{
  sessionId: string
  stopReason: string
  toolCalls: number
  /** Execution context. Omitted = `'main'`. */
  context?: LifecycleContext
  /** When `context === 'subagent'`, the fully qualified `<plugin>:<name>`. */
  agentName?: string
}>

export type BeforeAutoCompactPayload = Readonly<{
  sessionId: string
  tokensBefore: number
  threshold: number
  contextWindow: number
}>

/**
 * Fire `sessionStart` once the host wiring (registry, tools, plugins) is
 * settled and a session has been created. Called from cli.tsx after
 * `applyHookConfig` so user-defined handlers have a chance to register
 * before the event fires.
 */
export function fireSessionStart(
  registry: HookRegistry,
  payload: SessionStartPayload,
  opts?: FireOptions,
): Promise<InvocationResult[]> {
  return safeInvoke(registry, 'sessionStart', payload, opts)
}

/**
 * Fire `sessionEnd` on graceful or forced session disposal. The agent loop
 * does not own this — it's the host's responsibility (SIGINT / explicit
 * exit). Handlers should be brief: the fire is awaited inside the SIGINT
 * cleanup path with the rest of the flush work.
 */
export function fireSessionEnd(
  registry: HookRegistry,
  payload: SessionEndPayload,
  opts?: FireOptions,
): Promise<InvocationResult[]> {
  return safeInvoke(registry, 'sessionEnd', payload, opts)
}

/**
 * Fire `promptSubmit` immediately before the user's text is appended to
 * session.messages. Handlers can observe (and in future iters, mutate via
 * additionalContext) the prompt.
 */
export function firePromptSubmit(
  registry: HookRegistry,
  payload: PromptSubmitPayload,
  opts?: FireOptions,
): Promise<InvocationResult[]> {
  return safeInvoke(registry, 'promptSubmit', payload, opts)
}

/**
 * Fire `afterTurn` when the model emits a stop reason that ends the turn
 * (no further tool calls pending). Mirrors the shell-hook `afterTurn` event.
 */
export function fireAfterTurn(
  registry: HookRegistry,
  payload: AfterTurnPayload,
  opts?: FireOptions,
): Promise<InvocationResult[]> {
  return safeInvoke(registry, 'afterTurn', payload, opts)
}

/**
 * Fire `beforeAutoCompact` immediately before the agent loop decides to run
 * a compaction. A handler returning `{ skip: true }` vetoes the compaction
 * (mirrors `{ cancel: true }` from the shell-hook variant).
 *
 * Returns a digest the caller can act on directly.
 */
export async function fireBeforeAutoCompact(
  registry: HookRegistry,
  payload: BeforeAutoCompactPayload,
  opts?: FireOptions,
): Promise<{ skipped: boolean; reason?: string }> {
  const results = await safeInvoke(registry, 'beforeAutoCompact', payload, opts)
  for (const r of results) {
    if (r.outcome === 'success' && r.result?.skip === true) {
      return { skipped: true, reason: r.result.reason }
    }
  }
  return { skipped: false }
}
