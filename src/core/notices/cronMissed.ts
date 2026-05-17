// src/core/notices/cronMissed.ts
//
// P1 #5 — Surface missed cron tasks via the Welcome notice slot instead of
// `console.warn`. A `console.warn` printed by `bootRehydrate` lands on
// stderr immediately before ink mounts, so it either gets eaten by the
// alt-screen or races the renderer and corrupts the first frame. Routing
// the same information through a structured notice (rendered by
// `src/tui/Welcome/notices/CronMissedNotice.tsx`) puts it in the spot
// users actually look.
//
// Pure formatter: returns `null` when there's nothing to surface, or a
// `{ text, count }` payload otherwise. The TUI layer decides on color /
// container — this module knows nothing about ink.
//
// Mirrors the shape of `getEmergencyTipFromConfig` (sibling module):
//   - pure function over its inputs (no globals, no I/O),
//   - returns `null` for the empty case so callers can `prop ?? null`,
//   - the data is the strict subset the renderer needs (text + count).

/** Minimal projection of a missed task that this module cares about. */
export type CronMissedTaskInput = {
  /** Short opaque task ID — surfaced verbatim so the user can `/cron` it. */
  id: string
}

/** Notice payload consumed by `CronMissedNotice`. */
export type CronMissedNotice = {
  /** Human-readable single-line message, ready to render. */
  text: string
  /** Count of missed tasks (for renderer-side coloring / icon decisions). */
  count: number
}

/**
 * Build a notice payload from a list of missed cron tasks.
 *
 * - Returns `null` when `missed` is empty so the renderer can early-out.
 * - The message lists every ID inline because the count is expected to
 *   be small (one per cron task that hand-rolled past its window while
 *   Nuka was down). If we ever see large counts in practice, this can
 *   grow a truncate clause without changing the contract.
 * - Wording deliberately avoids promising a "manual trigger" affordance
 *   the cron tools don't currently expose; tasks will fire on their next
 *   scheduled window via the normal scheduler tick.
 */
export function formatCronMissedNotice(
  missed: readonly CronMissedTaskInput[],
): CronMissedNotice | null {
  if (missed.length === 0) return null
  const count = missed.length
  const ids = missed.map((t) => t.id).join(', ')
  const noun = count === 1 ? 'task' : 'tasks'
  const verb = count === 1 ? 'was' : 'were'
  const text =
    `${count} scheduled ${noun} ${verb} missed while Nuka was down ` +
    `(${ids}) — will fire on the next scheduled window.`
  return { text, count }
}
