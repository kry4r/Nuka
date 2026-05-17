// src/core/hooks/events.ts
//
// In-process hook system: type definitions for the function-based registry.
//
// This is intentionally separate from the shell-command-based hooks defined
// in `types.ts` / `loader.ts` / `runner.ts`, which load `hooks.json` entries
// and exec them via `sh -c`. This file defines the in-process counterpart:
// handlers registered in TypeScript, invoked synchronously inside the agent
// process via `HookRegistry.invoke`.
//
// The two subsystems are orthogonal:
//   - shell hooks (types.ts/HookEntry/HookEvent): user-defined external
//     scripts loaded from config.
//   - in-process hooks (this file/InProcessHookEvent/HookHandler): code-defined
//     callbacks registered at runtime by callers (default hooks bundled with
//     the agent; plugin-contributed handlers in a later iter).

/**
 * Lifecycle events supported by the in-process hook system.
 *
 * Naming mirrors the shell-hook events where they overlap (`beforeToolCall`,
 * `afterToolCall`, `afterTurn`, `beforeAutoCompact`) and adds the broader
 * lifecycle markers from upstream Nuka-Code (`promptSubmit`, `sessionStart`,
 * `sessionEnd`, etc.).
 */
export const IN_PROCESS_HOOK_EVENTS = [
  'beforeToolCall',
  'afterToolCall',
  'afterToolCallFailure',
  'afterTurn',
  'beforeAutoCompact',
  'promptSubmit',
  'promptRendered',
  'sessionStart',
  'sessionEnd',
  'subagentStart',
  'notification',
  // Iter OOOO — shell-hook → in-process bridging. Fires once per shell
  // hook execution AFTER the shell process exits, regardless of whether
  // the shell hook vetoed. Payload shape: ShellHookExecutedPayload (see
  // src/core/hooks/shellBridge.ts). Handlers are advisory observers —
  // they cannot influence the shell hook outcome (the registry's
  // `skip:true` semantics do NOT propagate back to the shell runner).
  'shellHookExecuted',
] as const

export type InProcessHookEvent = (typeof IN_PROCESS_HOOK_EVENTS)[number]

export function isInProcessHookEvent(v: unknown): v is InProcessHookEvent {
  return typeof v === 'string' && (IN_PROCESS_HOOK_EVENTS as readonly string[]).includes(v)
}

/**
 * Context passed to a handler when an event fires. Callers may attach any
 * event-specific data via `payload`; common fields are typed for ergonomics.
 */
export type HookContext = {
  /** The event being fired. */
  event: InProcessHookEvent
  /** Tool name (when applicable: beforeToolCall / afterToolCall*). */
  toolName?: string
  /** Caller-provided event-specific payload. Opaque to the registry. */
  payload?: Readonly<Record<string, unknown>>
  /** Optional cancellation signal, propagated from `invoke({ signal })`. */
  signal?: AbortSignal
}

/**
 * A single handler's return value.
 *
 * - `skip: true` — request the caller to skip / cancel the original action
 *   (e.g. veto a tool call). Caller decides how to honour this; the registry
 *   itself does not abort downstream handlers when one returns `skip`.
 * - `additionalContext` — text the caller may attach to the conversation
 *   (mirrors upstream Nuka-Code's `additionalContext` semantics).
 * - `data` — opaque pass-through for caller-specific extensions.
 */
export type HookResult = {
  skip?: boolean
  reason?: string
  additionalContext?: string
  data?: Readonly<Record<string, unknown>>
}

/**
 * Function-based handler signature.
 *
 * May be sync (return `HookResult | void`) or async (return `Promise`).
 * Errors thrown are caught and isolated by the pipeline; they do not crash
 * sibling handlers and are reported in `InvocationResult.error`.
 */
export type HookHandler = (
  context: HookContext,
) => HookResult | void | Promise<HookResult | void>

/**
 * Options accepted by `HookRegistry.register`.
 */
export type RegisterOptions = {
  /**
   * Stable handler ID. If omitted, the registry generates one. Useful for
   * idempotent re-registration (e.g. on hot-reload) — re-registering the same
   * `id` replaces the previous handler.
   */
  id?: string
  /**
   * Higher priority runs earlier. Defaults to 0. Handlers with identical
   * priority run in insertion order.
   */
  priority?: number
}

/**
 * Internal record produced by `register` and surfaced via `list`.
 */
export type RegisteredHook = {
  id: string
  event: InProcessHookEvent
  handler: HookHandler
  priority: number
  /** Monotonic insertion counter; used to break priority ties. */
  insertionOrder: number
}

/**
 * Outcome of running a single handler during `invoke`.
 *
 * Always present: `id`, `event`, `outcome`. `result` is the handler's return
 * value when `outcome === 'success'`; `error` is the thrown value when
 * `outcome === 'error'`; `outcome === 'aborted'` means the handler did not
 * run because the AbortSignal was already aborted.
 */
export type InvocationResult =
  | { id: string; event: InProcessHookEvent; outcome: 'success'; result: HookResult | undefined }
  | { id: string; event: InProcessHookEvent; outcome: 'error'; error: Error }
  | { id: string; event: InProcessHookEvent; outcome: 'aborted' }

/**
 * Options accepted by `HookRegistry.invoke`.
 */
export type InvokeOptions = {
  signal?: AbortSignal
}
