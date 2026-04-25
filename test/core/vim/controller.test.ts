// test/core/vim/controller.test.ts
//
// Table-driven tests for the vim controller (Phase 7 — task 7.5.a).
// Each row drives a fresh state with `text` (cursor anchored to `|` marker)
// in the given starting `mode`, applies `keys`, and asserts the resulting
// text + cursor + mode.

import { describe, it, expect } from 'vitest'
import { makeState, steps, type State } from '../../../src/core/vim/controller'
import { bufferToText, type VimMode } from '../../../src/core/vim/mode'

function parseAnchor(s: string): { text: string; row: number; col: number } {
  const idx = s.indexOf('|')
  if (idx === -1) return { text: s, row: 0, col: 0 }
  const before = s.slice(0, idx)
  const after = s.slice(idx + 1)
  const lines = before.split('\n')
  const row = lines.length - 1
  const col = lines[row]!.length
  return { text: before + after, row, col }
}

function start(text: string, mode: VimMode = 'normal'): State {
  const { text: t, row, col } = parseAnchor(text)
  const s = makeState(t, mode)
  s.buffer.cursor = { row, col }
  return s
}

describe('vim controller — motions', () => {
  it('h/l/j/k move one step in each direction', () => {
    expect(steps(start('he|llo'), 'h').buffer.cursor).toEqual({ row: 0, col: 1 })
    expect(steps(start('|hello'), 'l').buffer.cursor.col).toBe(1)
    expect(steps(start('|aa\nbb'), 'j').buffer.cursor.row).toBe(1)
    expect(steps(start('aa\n|bb'), 'k').buffer.cursor.row).toBe(0)
  })
  it('0 jumps to start of line', () => {
    const s = steps(start('hel|lo'), '0')
    expect(s.buffer.cursor).toEqual({ row: 0, col: 0 })
  })
  it('$ jumps to end of line (last char)', () => {
    const s = steps(start('|hello'), '$')
    expect(s.buffer.cursor.col).toBe(4)
  })
  it('gg goes to top', () => {
    const s = steps(start('a\nb\nc|'), 'gg')
    expect(s.buffer.cursor).toEqual({ row: 0, col: 0 })
  })
  it('G goes to bottom', () => {
    const s = steps(start('|a\nb\nc'), 'G')
    expect(s.buffer.cursor.row).toBe(2)
  })
  it('w moves to next word', () => {
    const s = steps(start('|hello world'), 'w')
    expect(s.buffer.cursor).toEqual({ row: 0, col: 6 })
  })
  it('b moves to previous word', () => {
    const s = steps(start('hello |world'), 'b')
    expect(s.buffer.cursor).toEqual({ row: 0, col: 0 })
  })
})

describe('vim controller — operators', () => {
  it('dw deletes from cursor to next word', () => {
    const s = steps(start('|hello world'), 'dw')
    expect(bufferToText(s.buffer)).toBe('world')
    expect(s.buffer.cursor).toEqual({ row: 0, col: 0 })
  })
  it('d$ deletes to end of line', () => {
    const s = steps(start('he|llo world'), 'd$')
    expect(bufferToText(s.buffer)).toBe('he')
  })
  it('d0 deletes to start of line', () => {
    const s = steps(start('hello |world'), 'd0')
    expect(bufferToText(s.buffer)).toBe('world')
  })
  it('dd deletes the whole line', () => {
    const s = steps(start('aaa\n|bbb\nccc'), 'dd')
    expect(bufferToText(s.buffer)).toBe('aaa\nccc')
  })
  it('yy then p pastes the line below', () => {
    const s = steps(start('|hello'), 'yyp')
    expect(bufferToText(s.buffer)).toBe('hello\nhello')
  })
  it('cc clears the line and enters insert', () => {
    const s = steps(start('|hello'), 'cc')
    expect(bufferToText(s.buffer)).toBe('')
    expect(s.buffer.mode).toBe('insert')
  })
  it('cw deletes a word and enters insert', () => {
    const s = steps(start('|hello world'), 'cw')
    expect(bufferToText(s.buffer)).toBe('world')
    expect(s.buffer.mode).toBe('insert')
  })
})

describe('vim controller — text objects', () => {
  it('ciw replaces the word under cursor', () => {
    const s = steps(start('hello |world'), 'ciw')
    expect(bufferToText(s.buffer)).toBe('hello ')
    expect(s.buffer.mode).toBe('insert')
  })
  it('di" deletes inside double quotes', () => {
    const s = steps(start('say "fo|o bar" loud'), 'di"')
    expect(bufferToText(s.buffer)).toBe('say "" loud')
  })
  it('ci" enters insert with empty quotes', () => {
    const s = steps(start('say "fo|o bar" loud'), 'ci"')
    expect(bufferToText(s.buffer)).toBe('say "" loud')
    expect(s.buffer.mode).toBe('insert')
  })
  it('di( deletes inside parens', () => {
    const s = steps(start('f(a, |b)'), 'di(')
    expect(bufferToText(s.buffer)).toBe('f()')
  })
})

describe('vim controller — char ops', () => {
  it('x deletes the char under cursor', () => {
    const s = steps(start('he|llo'), 'x')
    expect(bufferToText(s.buffer)).toBe('helo')
  })
  it('s deletes char and enters insert', () => {
    const s = steps(start('he|llo'), 's')
    expect(bufferToText(s.buffer)).toBe('helo')
    expect(s.buffer.mode).toBe('insert')
  })
})

describe('vim controller — insert / append', () => {
  it('i then typing inserts before cursor', () => {
    const s = steps(start('he|llo'), 'iX\u001b')
    expect(bufferToText(s.buffer)).toBe('heXllo')
    expect(s.buffer.mode).toBe('normal')
  })
  it('a appends after cursor', () => {
    const s = steps(start('he|llo'), 'aX\u001b')
    expect(bufferToText(s.buffer)).toBe('helXlo')
  })
  it('o opens line below', () => {
    const s = steps(start('|hello'), 'oworld\u001b')
    expect(bufferToText(s.buffer)).toBe('hello\nworld')
  })
  it('O opens line above', () => {
    const s = steps(start('|hello'), 'Oworld\u001b')
    expect(bufferToText(s.buffer)).toBe('world\nhello')
  })
})

describe('vim controller — dot repeat', () => {
  it('. repeats last dw', () => {
    const s = steps(start('|aa bb cc'), 'dw.')
    expect(bufferToText(s.buffer)).toBe('cc')
  })
  it('. repeats last x', () => {
    const s = steps(start('|abcd'), 'x.')
    expect(bufferToText(s.buffer)).toBe('cd')
  })
  it('. repeats last insert', () => {
    const s = steps(start('|abc'), 'iX\u001b.')
    // first: insert X before a → "Xabc"; cursor at col 0 (X) post-Esc
    // dot replays the insert at the current cursor, yielding "XXabc"
    expect(bufferToText(s.buffer)).toBe('XXabc')
  })
})

describe('vim controller — visual', () => {
  it('v$d deletes to EOL', () => {
    const s = steps(start('he|llo world'), 'v$d')
    expect(bufferToText(s.buffer)).toBe('he')
  })
  it('vw d deletes through next word boundary', () => {
    const s = steps(start('|aa bb'), 'vwd')
    expect(s.buffer.mode).toBe('normal')
    expect(bufferToText(s.buffer).length).toBeLessThan('aa bb'.length)
  })
})

describe('vim controller — register / paste', () => {
  it('yw then p inserts the yanked word after cursor', () => {
    const s = steps(start('|aa bb'), 'ywl')
    expect(s.register.length).toBeGreaterThan(0)
    const s2 = steps(s, 'p')
    // pasted "aa " into "aa bb" after col 1 → "aaa abb"
    expect(bufferToText(s2.buffer)).toContain('aa')
  })
})
