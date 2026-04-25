// src/core/vim/textObjects.ts
//
// Text objects describe a range in the buffer. We support `iw`, `i"`, `i(`.
// All are "inner" — exclude the surrounding delimiters / whitespace.

import type { Buffer } from './mode'

export type Range = { startRow: number; startCol: number; endRow: number; endCol: number }

export type TextObject =
  | { kind: 'iw' }
  | { kind: 'i"' }
  | { kind: 'i(' }

function isWordChar(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch)
}

/** Inner-word: walk outward from the cursor while the char is a word-char. */
export function innerWord(b: Buffer): Range | null {
  const { row, col } = b.cursor
  const line = b.lines[row] ?? ''
  if (line.length === 0) return null
  if (!isWordChar(line[col] ?? '')) return null
  let s = col
  while (s > 0 && isWordChar(line[s - 1]!)) s--
  let e = col
  while (e < line.length - 1 && isWordChar(line[e + 1]!)) e++
  return { startRow: row, startCol: s, endRow: row, endCol: e + 1 } // end-exclusive
}

/** Inner-quoted: find nearest pair of `"` on the cursor's line that surround col. */
export function innerQuoted(b: Buffer, quote = '"'): Range | null {
  const { row, col } = b.cursor
  const line = b.lines[row] ?? ''
  // find the latest quote at or before col, then the next quote after it
  let l = -1
  for (let i = col; i >= 0; i--) {
    if (line[i] === quote) { l = i; break }
  }
  if (l === -1) {
    // try forward search for both quotes
    const a = line.indexOf(quote)
    if (a === -1) return null
    const b2 = line.indexOf(quote, a + 1)
    if (b2 === -1) return null
    return { startRow: row, startCol: a + 1, endRow: row, endCol: b2 }
  }
  const r = line.indexOf(quote, l + 1)
  if (r === -1) return null
  return { startRow: row, startCol: l + 1, endRow: row, endCol: r }
}

/** Inner-paren: find pair of `(` `)` enclosing the cursor on the same line. */
export function innerParen(b: Buffer, open = '(', close = ')'): Range | null {
  const { row, col } = b.cursor
  const line = b.lines[row] ?? ''
  // walk left, tracking depth
  let depth = 0
  let l = -1
  for (let i = col; i >= 0; i--) {
    const ch = line[i]
    if (ch === close) depth++
    else if (ch === open) {
      if (depth === 0) { l = i; break }
      depth--
    }
  }
  if (l === -1) return null
  // walk right from l+1 for matching close
  depth = 0
  let r = -1
  for (let i = l + 1; i < line.length; i++) {
    const ch = line[i]
    if (ch === open) depth++
    else if (ch === close) {
      if (depth === 0) { r = i; break }
      depth--
    }
  }
  if (r === -1) return null
  return { startRow: row, startCol: l + 1, endRow: row, endCol: r }
}

export function applyTextObject(b: Buffer, t: TextObject): Range | null {
  switch (t.kind) {
    case 'iw': return innerWord(b)
    case 'i"': return innerQuoted(b, '"')
    case 'i(': return innerParen(b, '(', ')')
  }
}
