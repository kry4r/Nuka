// src/core/testing/keystrokes.ts
//
// Named constants for raw character sequences that ink-testing-library
// `stdin.write` understands. Plan authors reference these via the
// `keystroke(name)` helper or by typing the characters directly into a
// `keystroke` step.

export const ENTER = '\r'
export const ESC = '\u001B'
export const UP = '\u001B[A'
export const DOWN = '\u001B[B'
export const LEFT = '\u001B[D'
export const RIGHT = '\u001B[C'
export const TAB = '\t'
export const BACKSPACE = '\u007F'
export const CTRL_C = '\u0003'

const TABLE: Record<string, string> = {
  ENTER, RETURN: ENTER,
  ESC, ESCAPE: ESC,
  UP, DOWN, LEFT, RIGHT,
  TAB,
  BACKSPACE, BS: BACKSPACE,
  CTRL_C, 'CTRL-C': CTRL_C, 'C-C': CTRL_C,
}

/** Look up a named keystroke (case-insensitive). Throws on unknown name. */
export function keystroke(name: string): string {
  const k = name.toUpperCase().replace(/\s+/g, '')
  const v = TABLE[k]
  if (v === undefined) throw new Error(`unknown keystroke: ${name}`)
  return v
}
