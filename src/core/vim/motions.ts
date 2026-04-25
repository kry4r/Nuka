// src/core/vim/motions.ts
//
// Pure motion functions: given a buffer, return a NEW cursor position.
// Motions are also used by operators to compute a target range.

import type { Buffer, Cursor } from './mode'

export type Motion =
  | { kind: 'h' }
  | { kind: 'l' }
  | { kind: 'j' }
  | { kind: 'k' }
  | { kind: 'w' }
  | { kind: 'b' }
  | { kind: '0' }
  | { kind: '$' }
  | { kind: 'gg' }
  | { kind: 'G' }
  | { kind: 'lineEnd' } // exclusive end-of-line (col === line.length)

/** Returns the (row,col) the cursor would move to. Does not mutate. */
export function applyMotion(b: Buffer, m: Motion): Cursor {
  const { row, col } = b.cursor
  const line = b.lines[row] ?? ''
  switch (m.kind) {
    case 'h':
      return { row, col: Math.max(0, col - 1) }
    case 'l': {
      const max = b.mode === 'insert' ? line.length : Math.max(0, line.length - 1)
      return { row, col: Math.min(max, col + 1) }
    }
    case 'j': {
      const r = Math.min(b.lines.length - 1, row + 1)
      return { row: r, col }
    }
    case 'k': {
      const r = Math.max(0, row - 1)
      return { row: r, col }
    }
    case '0':
      return { row, col: 0 }
    case '$': {
      // In normal mode, $ is the last character; in insert mode it's len.
      const lastCol = b.mode === 'insert' ? line.length : Math.max(0, line.length - 1)
      return { row, col: lastCol }
    }
    case 'lineEnd':
      return { row, col: line.length }
    case 'gg':
      return { row: 0, col: 0 }
    case 'G':
      return { row: b.lines.length - 1, col: 0 }
    case 'w':
      return wordForward(b)
    case 'b':
      return wordBackward(b)
  }
}

/** Word characters: [A-Za-z0-9_]. Whitespace splits words. */
function isWordChar(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch)
}
function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\t'
}

/** Move to the start of the next word. Skips current word + following spaces.
 *  At end of line, jumps to col 0 of next line. */
export function wordForward(b: Buffer): Cursor {
  let { row, col } = b.cursor
  while (row < b.lines.length) {
    const line = b.lines[row] ?? ''
    // skip current word chars
    if (col < line.length && isWordChar(line[col]!)) {
      while (col < line.length && isWordChar(line[col]!)) col++
    } else if (col < line.length && !isSpace(line[col]!)) {
      // skip a single punctuation cluster (treat as a word)
      while (col < line.length && !isSpace(line[col]!) && !isWordChar(line[col]!)) col++
    }
    // skip whitespace
    while (col < line.length && isSpace(line[col]!)) col++
    if (col < line.length) return { row, col }
    // wrap to next line
    row++
    col = 0
    if (row < b.lines.length && (b.lines[row] ?? '').length > 0) return { row, col: 0 }
  }
  // clamp
  const lastRow = b.lines.length - 1
  const lastLine = b.lines[lastRow] ?? ''
  return { row: lastRow, col: Math.max(0, lastLine.length - 1) }
}

/** Move to start of the previous word. */
export function wordBackward(b: Buffer): Cursor {
  let { row, col } = b.cursor
  while (row >= 0) {
    const line = b.lines[row] ?? ''
    // step left first
    if (col > 0) col--
    else if (row > 0) {
      row--
      const prev = b.lines[row] ?? ''
      col = Math.max(0, prev.length - 1)
      continue
    } else return { row: 0, col: 0 }
    // skip whitespace going left
    while (col > 0 && isSpace(line[col]!)) col--
    // walk to the start of the word
    if (isWordChar(line[col]!)) {
      while (col > 0 && isWordChar(line[col - 1]!)) col--
    } else if (!isSpace(line[col]!)) {
      while (col > 0 && !isSpace(line[col - 1]!) && !isWordChar(line[col - 1]!)) col--
    }
    return { row, col }
  }
  return { row: 0, col: 0 }
}
