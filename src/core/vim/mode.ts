// src/core/vim/mode.ts
//
// Buffer + mode types shared by motions/operators/textObjects/controller.

export type VimMode = 'insert' | 'normal' | 'visual'

export type Cursor = { row: number; col: number }

export type Buffer = {
  lines: string[]
  cursor: Cursor
  mode: VimMode
}

/** Clone the buffer (cheap: lines array shallow-copied — strings are immutable). */
export function cloneBuffer(b: Buffer): Buffer {
  return {
    lines: b.lines.slice(),
    cursor: { row: b.cursor.row, col: b.cursor.col },
    mode: b.mode,
  }
}

/** Clamp the cursor into a valid position for `mode`. In normal mode the cursor
 *  sits OVER a char, so col must be in [0, len-1] (or 0 for empty line).
 *  In insert mode it sits between chars, so col may be in [0, len].
 */
export function clampCursor(b: Buffer): Buffer {
  const out = cloneBuffer(b)
  if (out.lines.length === 0) out.lines = ['']
  if (out.cursor.row < 0) out.cursor.row = 0
  if (out.cursor.row >= out.lines.length) out.cursor.row = out.lines.length - 1
  const line = out.lines[out.cursor.row] ?? ''
  const max = out.mode === 'insert' ? line.length : Math.max(0, line.length - 1)
  if (out.cursor.col < 0) out.cursor.col = 0
  if (out.cursor.col > max) out.cursor.col = max
  return out
}

/** Build a fresh buffer in insert mode. Empty content → one empty line. */
export function makeBuffer(text: string, mode: VimMode = 'insert'): Buffer {
  const lines = text === '' ? [''] : text.split('\n')
  return clampCursor({ lines, cursor: { row: 0, col: 0 }, mode })
}

export function bufferToText(b: Buffer): string {
  return b.lines.join('\n')
}
