// src/core/session/cronPromptQueue.ts
//
// Practical Iter JJJJ — Cron fire → agent input.
//
// The cron scheduler (Iter GGGG) fires tasks via a `fire(taskId, task, firedAt)`
// callback whose first-pass implementation just wrote to stderr. This module
// is the routing surface that bridges those fires into the agent's input
// stream: the scheduler's fire callback pushes onto a `CronPromptQueue`,
// and the agent loop drains the queue at the start of each runAgent call,
// synthesising user messages for each fired prompt.
//
// Why a separate queue (vs. piggybacking on `Session.queue`):
//   • `Session.queue` is per-session; cron fires are process-wide and may
//     land before any session is active. A single queue keeps the
//     scheduler oblivious to session lifecycle.
//   • Cron entries carry context (`taskId`, `firedAt`) that the bare-string
//     MessageQueue cannot represent without lossy stringification. Keeping
//     them structured here lets future consumers (TUI banner, telemetry)
//     distinguish a cron-injected prompt from a `/btw` push.
//   • Drain semantics differ: MessageQueue drains at end-of-turn after a
//     tool call; the cron queue drains at start-of-runAgent so a fire that
//     lands while the model is idle still surfaces on the very next turn,
//     regardless of whether the user's last turn used tools.
//
// Opt-in: the agent loop only drains this queue when
// `NUKA_CRON_INJECT_PROMPTS=1` is in the environment. Default OFF preserves
// existing behaviour (cron fires log to stderr but don't talk to the
// model) — surprise periodic model invocations in production are opt-in,
// matching the same posture as `NUKA_CRON_SCHEDULER=1`.

/**
 * One entry pushed onto the queue by the cron scheduler's `fire` callback.
 * Carries the task id and the wall-clock fire time so consumers can render
 * a faithful "[CRON id @ time] prompt" surface.
 */
export type CronPromptEntry = {
  /** The cron task's opaque id (matches `CronTask.id`). */
  taskId: string
  /** The prompt body the task was registered with. */
  prompt: string
  /** Epoch ms when the scheduler decided this task was due. */
  firedAt: number
}

/**
 * FIFO queue of cron-fired prompts pending injection into the agent loop.
 *
 * Pattern matches `MessageQueue`: producers `enqueue`, consumers `drain`.
 * The queue is intentionally minimal — no persistence, no dedupe, no
 * back-pressure. If the process exits with entries pending, they are lost;
 * cron fire is best-effort and the scheduler will re-fire on the next due
 * window for recurring tasks.
 *
 * Thread-safety: Node is single-threaded, so the array mutations are safe
 * without locks. Concurrent `enqueue` calls from setInterval ticks and
 * `drain` calls from the agent loop interleave at await boundaries only,
 * which preserves FIFO order.
 */
export class CronPromptQueue {
  private queue: CronPromptEntry[] = []

  /**
   * Append a cron fire to the back of the queue. Called from the scheduler's
   * `fire` callback. Returns void — push is unconditional and cannot fail
   * (queue size is unbounded by design; cron tools cap at 50 jobs, so the
   * worst case is 50 entries per tick).
   */
  enqueue(taskId: string, prompt: string, firedAt: number): void {
    this.queue.push({ taskId, prompt, firedAt })
  }

  /**
   * Remove and return all pending entries in FIFO order. The queue is empty
   * after this call. Matches `MessageQueue.drain` semantics so the agent
   * loop integration mirrors the existing /btw queue plumbing.
   */
  drain(): CronPromptEntry[] {
    const out = this.queue
    this.queue = []
    return out
  }

  /**
   * Read-only view of pending entries without removing them. Useful for
   * tests + future UI surfaces (e.g. "3 cron fires pending" banner).
   */
  peek(): readonly CronPromptEntry[] {
    return this.queue
  }

  /** Pending entry count. */
  get size(): number {
    return this.queue.length
  }
}

/**
 * Env-var gate for the loop's drain-and-inject path. Centralised here so
 * the scheduler-side wiring (cli.tsx) and the consumer-side gate (loop.ts)
 * agree on the var name + casing without one drifting from the other.
 *
 * Returns true iff `NUKA_CRON_INJECT_PROMPTS=1`. Any other value (including
 * '0', 'true', empty, or unset) reads as false — exact-match keeps the
 * opt-in posture unambiguous.
 */
export function isCronPromptInjectionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['NUKA_CRON_INJECT_PROMPTS'] === '1'
}

/**
 * Format a single drained entry into the prefix-formatted text that lands
 * on the transcript as a synthetic user message.
 *
 * The `[CRON ${taskId}]` prefix makes a cron-injected turn visually
 * distinct from a user-typed prompt in any transcript dump (REPL log,
 * `/recap`, `session.messages` JSON) without needing a new message role.
 */
export function formatCronPrompt(entry: CronPromptEntry): string {
  return `[CRON ${entry.taskId}] ${entry.prompt}`
}
