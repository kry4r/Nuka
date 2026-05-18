// src/tui/Messages/staticGating.ts
//
// Pure function extracted from Messages.tsx:168 so that tests can import and
// exercise the real gate without mounting the full component.

export type PrologueGateInput = {
  prologue: unknown
  total: number
  streaming: unknown
  /**
   * Retained for back-compat; no longer used by the gate logic.
   * The simplified gate flips solely on total > 0 (real messages in
   * session.messages) — streaming-only state is insufficient because
   * a streaming flicker with no real messages should not push the
   * prologue into Static permanently.
   */
  hasEverStreamed?: boolean
}

/**
 * Returns true when the prologue should move from the live area into Ink's
 * Static channel (i.e. scroll off-screen with the conversation).
 *
 * Gate: flip iff there is at least one real message in items (total > 0).
 *
 * This is both necessary (the live area needs room for messages) and
 * sufficient (a streaming-only state with no real messages does not
 * warrant a permanent prologue eviction, since Static is append-only and
 * the prologue can never return to live once pushed).
 *
 * The previous M6.T3 formula required hasEverStreamed in addition to
 * total > 0, which blocked the flip when a slash command produced a
 * real message (total 0→1) but no streaming had occurred. That broke
 * the /plan harness test and the 05-plan-mode-lockout sample plan.
 * The root cause was a misidentification of bumpMessages() as the
 * mechanism incrementing total — bumpMessages() only bumps a render
 * tick, never session.messages.length, so total > 0 already requires
 * a real appendMessage() call.
 */
export function shouldPrologueGoStatic({
  prologue,
  total,
}: PrologueGateInput): boolean {
  if (!prologue) return false
  return total > 0
}
