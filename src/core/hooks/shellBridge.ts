// src/core/hooks/shellBridge.ts
//
// Iter OOOO — bridge shell-hook executions to in-process registry events.
//
// Background:
//   Nuka ships TWO orthogonal hook subsystems (see `events.ts` header):
//     1. Shell-command hooks (`runner.ts`/`loader.ts`/`types.ts`) — config
//        loaded from `hooks.json`, executed via `sh -c`, veto via stdout
//        JSON `{cancel: true}`.
//     2. In-process function hooks (`registry.ts`/`events.ts`/`pipeline.ts`)
//        — TypeScript handlers, veto via return value `{skip: true}`.
//
//   They've evolved side-by-side and don't talk to each other. Anything
//   that listens on the in-process registry (telemetry, plugin observers,
//   UI banners) is blind to shell hook executions.
//
// This module bridges (1) → (2) with a side-channel emit: after every
// shell hook execution, the runner fires an in-process `shellHookExecuted`
// event with a digest of the run. Existing shell-hook consumers see the
// SAME shape they always did (back-compat for the `runHooks` return
// value); the bridge is purely additive.
//
// Why side-channel and not unified-pipeline:
//   - Shell hooks can already veto; the in-process registry can already
//     veto. Combining the two would double the veto surface and force a
//     "which wins" policy that's easy to get wrong.
//   - Observers (the consumers this is for) don't need veto power — they
//     just need to know shell hooks happened. A read-only side channel
//     gives them everything without any new policy decisions.
//   - It's reversible. If a future iter wants tighter coupling, the
//     payload shape is already the right primitive.

import type { HookRegistry } from './registry'
import type { HookEvent, HookEntry } from './types'
import type { InvocationResult } from './events'

/**
 * Payload fired on the in-process registry's `shellHookExecuted` event
 * for every shell hook execution. Observer-only — handlers cannot
 * influence whether the originating shell hook ran or vetoed.
 */
export interface ShellHookExecutedPayload {
  /** Shell hook event name that triggered this execution. */
  event: HookEvent
  /**
   * Stable identifier for the shell hook entry. Built from
   * `event:tool:command-hash` so consumers can correlate repeated fires of
   * the same entry across a session. See {@link hookEntryToHookId}.
   */
  hookId: string
  /** Shell command, truncated to 500 chars for safety. */
  command: string
  /**
   * Process exit code. `-1` indicates the shell process couldn't be
   * launched (e.g. timeout, ENOENT) — the matching shell-runner
   * branch returns `{ ok: false }` and we surface that here as `-1`.
   */
  exitCode: number
  /** First ~500 chars of stdout. Omitted when launch failed. */
  stdoutPreview?: string
  /** First ~500 chars of stderr. Always present when launch succeeded. */
  stderrPreview?: string
  /**
   * Whether the shell hook's stdout JSON requested `cancel:true`. Mirrors
   * the existing veto semantics in `runner.ts`.
   */
  canceled: boolean
  /** Wall-clock duration of the hook execution in milliseconds. */
  durationMs: number
  /**
   * Optional tool-name filter that was active for the event. Helps
   * consumers correlate the fire with the original `runHooks` call —
   * shell hooks scoped to a specific tool surface their tool here.
   */
  tool?: string
  /**
   * Set when the shell runner caught a launch error (timeout, ENOENT,
   * etc.) rather than a non-zero exit. Mutually exclusive with
   * `stdoutPreview`.
   */
  errorMessage?: string
}

/**
 * Truncate a string preview to `maxLen` chars, appending `…` when trimmed.
 * Defensive against non-string `value` so we can call this on `stderr` /
 * `stdout` without first narrowing every branch in `runner.ts`.
 */
export function truncatePreview(value: string | undefined, maxLen: number): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') return undefined
  if (value.length <= maxLen) return value
  // Reserve 1 char for the ellipsis so the result length stays at exactly
  // `maxLen`. We don't try to be UTF-8-aware here — preview is a digest,
  // not a payload the consumer feeds back into the shell.
  return value.slice(0, Math.max(0, maxLen - 1)) + '…'
}

/**
 * Stable per-entry identifier. Concatenates event/tool/command into a
 * short hash so a `shellHookExecuted` consumer can group repeat fires
 * for the same entry without holding the full command string.
 *
 * Pure string ops — no `node:crypto` dep (keeps the bridge importable from
 * any runtime). Collisions are theoretically possible but practically
 * irrelevant: shell hooks are user-defined, not adversarial, and the
 * consumer treats the ID as a correlation key not a security primitive.
 */
export function hookEntryToHookId(entry: HookEntry): string {
  const toolPart = entry.tool ?? '*'
  // FNV-1a 32-bit hash of the command — small, fast, no deps.
  let hash = 0x811c9dc5
  for (let i = 0; i < entry.command.length; i++) {
    hash ^= entry.command.charCodeAt(i)
    // 32-bit multiply via Math.imul to avoid JS bigint mode.
    hash = Math.imul(hash, 0x01000193)
  }
  // Force the sign bit off so the hex form is stable across platforms.
  const hex = (hash >>> 0).toString(16).padStart(8, '0')
  return `${entry.event}:${toolPart}:${hex}`
}

/**
 * Fire the `shellHookExecuted` event on the supplied registry.
 *
 * The fire is best-effort: handlers run sequentially through the same
 * pipeline as any other in-process event, and per-handler errors are
 * already isolated by `runOneHandler`. We return the raw
 * {@link InvocationResult} array so tests / advanced callers can inspect
 * handler outcomes; production callers normally ignore the return value.
 *
 * Important: this DOES NOT honour `{ skip: true }` returns. The shell
 * hook has already executed by the time we fire this event — handlers
 * cannot retroactively cancel it. The skip flag is silently ignored on
 * this event.
 */
export function fireShellHookExecuted(
  registry: HookRegistry,
  payload: ShellHookExecutedPayload,
): Promise<InvocationResult[]> {
  // Cast the readonly payload through the registry's freeform
  // `Record<string, unknown>` slot. The payload fields are intentionally
  // shallow primitives so `Object.freeze` would be redundant; consumers
  // that mutate the payload do so at their own risk.
  return registry.invoke(
    'shellHookExecuted',
    { payload: payload as unknown as Readonly<Record<string, unknown>> },
  )
}
