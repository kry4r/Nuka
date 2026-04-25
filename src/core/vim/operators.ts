// src/core/vim/operators.ts
//
// Operators d/c/y act over a range. We compute ranges from motions or text-objects.

import type { Buffer } from './mode'
import { cloneBuffer } from './mode'
import type { Motion } from './motions'
import { applyMotion } from './motions'
import type { Range, TextObject } from './textObjects'
import { applyTextObject } from './textObjects'

export type OperatorKind = 'd' | 'c' | 'y'

export type OpResult = { buffer: Buffer; yanked: string }

/** Compute a range for a motion, treating it as half-open from cursor → motion-target.
 *  For `$` we extend through the last char (inclusive) to match vim's d$ semantics. */
export function rangeFromMotion(b: Buffer, m: Motion): Range | null {
  const start = b.cursor
  const target = applyMotion(b, m)
  // Order start/end
  const cmp = (a: { row: number; col: number }, c: { row: number; col: number }) =>
    a.row !== c.row ? a.row - c.row : a.col - c.col
  let s = start, e = target
  if (cmp(s, e) > 0) { s = target; e = start }
  // For $ we want to delete THROUGH the last char on the line
  if (m.kind === '$') {
    const line = b.lines[e.row] ?? ''
    return { startRow: s.row, startCol: s.col, endRow: e.row, endCol: line.length }
  }
  // For h, the half-open interval excludes the char under cursor; vim's `dh` deletes the char to the LEFT.
  // To match: if motion is `h` and target.col < start.col, end is start (exclusive of start char), start is target.
  // Already handled by ordering above (s = target, e = start) — half-open [s, e) deletes target..start-1, that's the char to the left. ✓
  // For w: half-open [cursor, next-word-start) which is what we want.
  // For 0: deletes from col 0 up to (not including) cursor. Already correct.
  return { startRow: s.row, startCol: s.col, endRow: e.row, endCol: e.col }
}

export function rangeFromTextObject(b: Buffer, t: TextObject): Range | null {
  return applyTextObject(b, t)
}

/** Slice the text inside a range (ranges don't span newlines for this subset). */
export function textInRange(b: Buffer, r: Range): string {
  if (r.startRow === r.endRow) {
    const line = b.lines[r.startRow] ?? ''
    return line.slice(r.startCol, r.endCol)
  }
  // multi-line (rare in our subset, e.g. d$ on last line + dj)
  const out: string[] = []
  for (let row = r.startRow; row <= r.endRow; row++) {
    const line = b.lines[row] ?? ''
    if (row === r.startRow) out.push(line.slice(r.startCol))
    else if (row === r.endRow) out.push(line.slice(0, r.endCol))
    else out.push(line)
  }
  return out.join('\n')
}

/** Delete the range, returning a new buffer with cursor at range start. */
export function deleteRange(b: Buffer, r: Range): Buffer {
  const out = cloneBuffer(b)
  if (r.startRow === r.endRow) {
    const line = out.lines[r.startRow] ?? ''
    out.lines[r.startRow] = line.slice(0, r.startCol) + line.slice(r.endCol)
  } else {
    const head = (out.lines[r.startRow] ?? '').slice(0, r.startCol)
    const tail = (out.lines[r.endRow] ?? '').slice(r.endCol)
    const newLine = head + tail
    out.lines.splice(r.startRow, r.endRow - r.startRow + 1, newLine)
  }
  out.cursor = { row: r.startRow, col: r.startCol }
  // clamp col for normal mode
  if (out.mode === 'normal') {
    const line = out.lines[out.cursor.row] ?? ''
    if (out.cursor.col > Math.max(0, line.length - 1)) {
      out.cursor.col = Math.max(0, line.length - 1)
    }
  }
  return out
}

export function applyOperator(b: Buffer, op: OperatorKind, range: Range): OpResult {
  const yanked = textInRange(b, range)
  if (op === 'y') {
    return { buffer: cloneBuffer(b), yanked }
  }
  let next = deleteRange(b, range)
  if (op === 'c') {
    next = cloneBuffer(next)
    next.mode = 'insert'
  }
  return { buffer: next, yanked }
}

/** Linewise dd/cc/yy: operate on the entire current line. */
export function applyOperatorLinewise(b: Buffer, op: OperatorKind): OpResult {
  const row = b.cursor.row
  const line = b.lines[row] ?? ''
  const yanked = line + '\n'
  if (op === 'y') return { buffer: cloneBuffer(b), yanked }
  const out = cloneBuffer(b)
  if (op === 'c') {
    out.lines[row] = ''
    out.cursor = { row, col: 0 }
    out.mode = 'insert'
    return { buffer: out, yanked }
  }
  // dd
  if (out.lines.length <= 1) {
    out.lines = ['']
    out.cursor = { row: 0, col: 0 }
  } else {
    out.lines.splice(row, 1)
    if (row >= out.lines.length) out.cursor.row = out.lines.length - 1
    out.cursor.col = 0
  }
  return { buffer: out, yanked }
}

/** Insert `text` at the cursor (used by `p` paste). */
export function pasteAfter(b: Buffer, text: string): Buffer {
  if (text === '') return cloneBuffer(b)
  const out = cloneBuffer(b)
  // If the yanked text ends with a newline, we paste as new line below.
  if (text.endsWith('\n')) {
    const body = text.slice(0, -1)
    const lines = body.split('\n')
    out.lines.splice(out.cursor.row + 1, 0, ...lines)
    out.cursor = { row: out.cursor.row + 1, col: 0 }
    return out
  }
  // Charwise: insert AFTER the cursor (vim's p)
  const row = out.cursor.row
  const line = out.lines[row] ?? ''
  const insertAt = Math.min(line.length, out.cursor.col + 1)
  out.lines[row] = line.slice(0, insertAt) + text + line.slice(insertAt)
  out.cursor = { row, col: insertAt + text.length - 1 }
  return out
}
