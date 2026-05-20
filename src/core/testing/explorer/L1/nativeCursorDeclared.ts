// src/core/testing/explorer/L1/nativeCursorDeclared.ts
//
// Opt-in invariant for focused text inputs. A rendered inverse-space cursor is
// not enough: Ink must also emit a positioned native terminal cursor so IME,
// accessibility tools, and the blinking terminal caret stay inside the input.

import type { AnsiGrid, InvariantCtx, Violation } from '../types'

export function nativeCursorDeclared(grid: AnsiGrid, ctx: InvariantCtx): Violation[] {
  void grid
  if (!ctx.fixtureCase?.requiresNativeCursor) return []

  const positioned = (ctx.cursorTraces ?? []).filter(e => e.positioned)
  if (positioned.length > 0) return []

  return [{
    rule: 'nativeCursorDeclared',
    severity: 'error',
    message:
      'Fixture requires a native terminal cursor, but no positioned cursor ' +
      'show escape was captured. Use Ink useCursor/Cursor instead of only ' +
      'rendering a fake cursor glyph.',
  }]
}
