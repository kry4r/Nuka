// src/core/sleep/tool.ts
//
// Sleep — agent-facing tool that pauses the agent for a specified duration.
//
// Use cases (upstream Nuka-Code prompt verbatim flavor):
//   - "user told you to sleep / rest"
//   - "you have nothing to do" between cron-fire ticks
//   - polling intervals where holding a shell process (Bash(sleep ...))
//     would be wasteful
//
// Unit: seconds. Upstream's underlying sleep helper (`src/utils/sleep.ts`)
// is millisecond-based, but the agent-facing tool exposes seconds because
// that's the natural granularity for "wait a bit" intents from the model
// (matches CronCreate's "9am" cadence rather than poll-loop precision).
// Internally we convert to ms before scheduling the timer.
//
// AbortSignal: yes — upstream's sleep() takes a signal and resolves
// silently on abort. We mirror that here by listening on `ctx.signal`,
// so a user-interrupt (or a session shutdown) cuts the wait short
// instead of pinning the agent for `seconds` seconds.
//
// Bounds:
//   - min 0 seconds (a no-op sleep returns immediately and is allowed —
//     useful as a yield)
//   - max 3600 seconds (1 hour). Beyond that, the model should use
//     CronCreate instead — a synchronous tool call holding the agent
//     for >1h is a misuse pattern, not a real intent.
//   - negative values are rejected (schema and runtime guard).
//
// Side-effects: none (no FS / no network). Parallel-safe — multiple
// concurrent Sleep calls don't interfere with each other.

import type { Tool, ToolContext, ToolResult } from '../tools/types'
import { defineTool } from '../tools/define'

export const SLEEP_TOOL_NAME = 'Sleep'

export const SLEEP_MAX_SECONDS = 3600

export type SleepInput = {
  seconds: number
}

/**
 * Abort-responsive sleep. Resolves after `ms` milliseconds, or
 * immediately when `signal` aborts. Mirrors upstream's
 * `src/utils/sleep.ts` semantics: silent resolve on abort — the caller
 * inspects `signal.aborted` to distinguish "slept fully" from "was
 * interrupted".
 *
 * Exported for tests; not part of the agent surface.
 */
export function sleepMs(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>(resolve => {
    if (signal?.aborted) {
      resolve()
      return
    }
    // ms === 0 short-circuits to a microtask yield. Avoids scheduling a
    // timer that fake-timer-based tests would need to advance, and
    // matches the natural "yield then return" semantic of a zero-wait.
    if (ms <= 0) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort(): void {
      clearTimeout(timer)
      resolve()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export const SleepTool: Tool<SleepInput> = defineTool<SleepInput>({
  name: SLEEP_TOOL_NAME,
  description:
    'Wait for a specified duration (in seconds). The user can interrupt the sleep at any time. ' +
    'Use this when the user tells you to sleep or rest, when you have nothing to do, or when you are waiting for something. ' +
    'Prefer this over `Bash(sleep ...)` — it does not hold a shell process. ' +
    'You can call this concurrently with other tools — it does not interfere with them.',
  parameters: {
    type: 'object',
    required: ['seconds'],
    properties: {
      seconds: {
        type: 'number',
        description:
          `How long to wait, in seconds. Must be between 0 and ${SLEEP_MAX_SECONDS} (1h). ` +
          'For waits longer than an hour, use CronCreate instead.',
        minimum: 0,
        maximum: SLEEP_MAX_SECONDS,
      },
    },
  },
  source: 'builtin',
  tags: ['core', 'sleep'],
  needsPermission: () => 'none',
  annotations: { readOnly: true, parallelSafe: true },
  searchHint: ['sleep', 'wait', 'pause', 'delay', 'rest'],
  async run(input: SleepInput, ctx: ToolContext): Promise<ToolResult> {
    const { seconds } = input
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
      return {
        isError: true,
        output: `Sleep: 'seconds' must be a finite number (got ${String(seconds)}).`,
      }
    }
    if (seconds < 0) {
      return {
        isError: true,
        output: `Sleep: 'seconds' must be >= 0 (got ${seconds}).`,
      }
    }
    if (seconds > SLEEP_MAX_SECONDS) {
      return {
        isError: true,
        output:
          `Sleep: 'seconds' must be <= ${SLEEP_MAX_SECONDS} (got ${seconds}). ` +
          'For longer waits, use CronCreate.',
      }
    }
    const ms = Math.round(seconds * 1000)
    const started = Date.now()
    await sleepMs(ms, ctx.signal)
    const elapsedMs = Date.now() - started
    if (ctx.signal.aborted) {
      return {
        isError: false,
        output: `Slept ${(elapsedMs / 1000).toFixed(3)}s (interrupted; requested ${seconds}s).`,
      }
    }
    return {
      isError: false,
      output: `Slept ${seconds}s.`,
    }
  },
})
