// src/core/testing/explorer/L0/staticTap.ts
//
// staticTap — post-render classifier for Ink Static commits.
// See locked spec §4.1.
//
// Ink <Static> items are written to stdout as plain text BEFORE the
// ESC[?25l (cursor-hide) sequence that starts each live-frame repaint.
// FakeStdout._inStaticWindow tracks this and routes those writes to
// staticBuffer.
//
// staticTap() is a thin wrapper that reads the staticBuffer from the handle's
// FakeStdout (via the staticWrites() API) and returns a structured result.
// It is also used as a fixture-level classifier: if a fixture sets
// allowStatic: true, noStaticWrites invariant skips the check.
//
// Catches the real Messages.tsx:168 pattern:
//   const prologueGoesStatic = !!props.prologue && (total > 0 || streaming !== null)
//   <Static items={staticItems}>…</Static>   // line 184
// When the prologue goes static, it shows up in staticBuffer; this tap
// surfaces that for the noStaticWrites invariant.

import type { InkRenderHandle } from '../types'

export type StaticTapResult = {
  /** Lines that were classified as Static commits (written before cursor-hide) */
  staticLines: string[]
  /** True if any static content was detected */
  hasStatic: boolean
}

/**
 * Read staticBuffer from a render handle and return classified lines.
 * Call after await-ing any async render steps.
 */
export function staticTap(handle: InkRenderHandle): StaticTapResult {
  const rawLines = handle.staticWrites()
  // Filter out empty lines and control-only lines
  const staticLines = rawLines
    .map(l => l.trim())
    .filter(l => l.length > 0)
  return {
    staticLines,
    hasStatic: staticLines.length > 0,
  }
}
