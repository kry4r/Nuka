// src/tui/Messages/staticGating.ts
//
// Pure function extracted from Messages.tsx:168 so that tests can import and
// exercise the real gate without mounting the full component.

export type PrologueGateInput = {
  prologue: unknown
  total: number
  streaming: unknown
}

/**
 * Returns true when the prologue should move from the live area into Ink's
 * Static channel (i.e. scroll off-screen with the conversation).
 *
 * Strict 1:1 copy of the inline expression in Messages.tsx:168.
 * Any M9/repair change to the gating logic must happen here.
 */
export function shouldPrologueGoStatic({ prologue, total, streaming }: PrologueGateInput): boolean {
  return !!prologue && (total > 0 || streaming !== null)
}
