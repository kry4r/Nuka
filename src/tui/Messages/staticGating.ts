// src/tui/Messages/staticGating.ts
//
// Pure function extracted from Messages.tsx:168 so that tests can import and
// exercise the real gate without mounting the full component.

export type PrologueGateInput = {
  prologue: unknown
  total: number
  streaming: unknown
  /**
   * M6.T3 — sticky bit owned by Messages.tsx (useRef): true once a
   * streaming message has appeared at least once in the session. Guards
   * the static-flip against transient `null → !null → null` flickers
   * that otherwise push the prologue into Static for a single frame.
   *
   * Optional + defaults to false so legacy callers (including the
   * Bug B2 fixture) keep compiling. When omitted, the gate degrades to
   * "only flip when there is a real message OR an active stream",
   * which fixes Bug B2 by itself.
   */
  hasEverStreamed?: boolean
}

/**
 * Returns true when the prologue should move from the live area into Ink's
 * Static channel (i.e. scroll off-screen with the conversation).
 *
 * M6.T3 fix: require both
 *   - (total > 0 || streaming !== null), AND
 *   - (streaming !== null || hasEverStreamed)
 * so a transient stream flicker (streaming flaps null → !null → null
 * within one frame) cannot push the prologue into Static when nothing
 * has actually been streamed yet. The legacy behavior also fired on
 * any bumpMessages() that incremented total — that's now blocked too,
 * because total > 0 without an actual stream history keeps the
 * prologue in the live area.
 */
export function shouldPrologueGoStatic({
  prologue,
  total,
  streaming,
  hasEverStreamed = false,
}: PrologueGateInput): boolean {
  if (!prologue) return false
  const hasContent = total > 0 || streaming !== null
  const everStreamed = streaming !== null || hasEverStreamed
  return hasContent && everStreamed
}
