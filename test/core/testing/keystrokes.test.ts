// test/core/testing/keystrokes.test.ts
import { describe, it, expect } from 'vitest'
import {
  ENTER, ESC, UP, DOWN, LEFT, RIGHT, TAB, BACKSPACE, CTRL_C, keystroke,
} from '../../../src/core/testing/keystrokes'

describe('keystroke constants', () => {
  it('export the documented escape sequences', () => {
    expect(ENTER).toBe('\r')
    expect(ESC).toBe('\u001B')
    expect(UP).toBe('\u001B[A')
    expect(DOWN).toBe('\u001B[B')
    expect(LEFT).toBe('\u001B[D')
    expect(RIGHT).toBe('\u001B[C')
    expect(TAB).toBe('\t')
    expect(BACKSPACE).toBe('\u007F')
    expect(CTRL_C).toBe('\u0003')
  })
})

describe('keystroke()', () => {
  it('looks up by canonical name (case-insensitive)', () => {
    expect(keystroke('ENTER')).toBe('\r')
    expect(keystroke('enter')).toBe('\r')
    expect(keystroke('Up')).toBe('\u001B[A')
  })

  it('accepts common aliases', () => {
    expect(keystroke('return')).toBe('\r')
    expect(keystroke('escape')).toBe('\u001B')
    expect(keystroke('bs')).toBe('\u007F')
    expect(keystroke('C-C')).toBe('\u0003')
    expect(keystroke('ctrl-c')).toBe('\u0003')
  })

  it('throws on unknown', () => {
    expect(() => keystroke('flarp')).toThrow(/unknown/)
  })
})
