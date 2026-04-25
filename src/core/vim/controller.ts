// src/core/vim/controller.ts
//
// Reducer: keystroke → new state. The state holds the buffer plus a small
// pending-operator scratchpad (for two-keystroke commands like `dw`, `ci"`),
// a single-slot register for `p`, and the last action for `.`.

import type { Buffer, VimMode } from './mode'
import { cloneBuffer, clampCursor, makeBuffer } from './mode'
import type { Motion } from './motions'
import { applyMotion } from './motions'
import type { TextObject } from './textObjects'
import {
  applyOperator,
  applyOperatorLinewise,
  pasteAfter,
  rangeFromMotion,
  rangeFromTextObject,
  type OperatorKind,
} from './operators'

/** A "completed action" for `.` repeat. */
export type RepeatAction =
  | { kind: 'op-motion'; op: OperatorKind; motion: Motion }
  | { kind: 'op-textobj'; op: OperatorKind; obj: TextObject }
  | { kind: 'op-line'; op: OperatorKind } // dd/cc/yy
  | { kind: 'x' }
  | { kind: 's' }
  | { kind: 'paste' }
  | { kind: 'insert'; text: string }

export type State = {
  buffer: Buffer
  /** Pending operator + optional `i` modifier for text-objects. */
  pending: { op?: OperatorKind; awaitingTextObj?: boolean; awaitingG?: boolean } | null
  register: string
  lastAction: RepeatAction | null
  /** Buffer of typed characters since entering insert mode (for `.` to replay). */
  insertBuffer: string
}

export function makeState(text: string, mode: VimMode = 'insert'): State {
  return {
    buffer: makeBuffer(text, mode),
    pending: null,
    register: '',
    lastAction: null,
    insertBuffer: '',
  }
}

export type Key =
  | { kind: 'char'; ch: string }
  | { kind: 'esc' }
  | { kind: 'enter' }
  | { kind: 'backspace' }

/** Apply a recorded action again — used by `.`. */
function replay(state: State, action: RepeatAction): State {
  let next = state
  switch (action.kind) {
    case 'op-motion': {
      const r = rangeFromMotion(next.buffer, action.motion)
      if (!r) return next
      const res = applyOperator(next.buffer, action.op, r)
      next = { ...next, buffer: res.buffer, register: res.yanked || next.register }
      break
    }
    case 'op-textobj': {
      const r = rangeFromTextObject(next.buffer, action.obj)
      if (!r) return next
      const res = applyOperator(next.buffer, action.op, r)
      next = { ...next, buffer: res.buffer, register: res.yanked || next.register }
      break
    }
    case 'op-line': {
      const res = applyOperatorLinewise(next.buffer, action.op)
      next = { ...next, buffer: res.buffer, register: res.yanked || next.register }
      break
    }
    case 'x': {
      next = { ...next, buffer: deleteCharUnderCursor(next.buffer) }
      break
    }
    case 's': {
      const b = deleteCharUnderCursor(next.buffer)
      b.mode = 'insert'
      next = { ...next, buffer: b }
      break
    }
    case 'paste': {
      next = { ...next, buffer: pasteAfter(next.buffer, next.register) }
      break
    }
    case 'insert': {
      let b = cloneBuffer(next.buffer)
      for (const ch of action.text) {
        b = insertCharAtCursor(b, ch)
      }
      b.mode = 'normal'
      // step cursor back like real vim does on Esc (col-1, min 0)
      b.cursor.col = Math.max(0, b.cursor.col - 1)
      b = clampCursor(b)
      next = { ...next, buffer: b }
      break
    }
  }
  return next
}

function deleteCharUnderCursor(b: Buffer): Buffer {
  const out = cloneBuffer(b)
  const line = out.lines[out.cursor.row] ?? ''
  if (line.length === 0) return out
  out.lines[out.cursor.row] = line.slice(0, out.cursor.col) + line.slice(out.cursor.col + 1)
  // clamp
  const newLine = out.lines[out.cursor.row] ?? ''
  if (out.cursor.col > Math.max(0, newLine.length - 1)) {
    out.cursor.col = Math.max(0, newLine.length - 1)
  }
  return out
}

function insertCharAtCursor(b: Buffer, ch: string): Buffer {
  const out = cloneBuffer(b)
  if (ch === '\n') {
    const line = out.lines[out.cursor.row] ?? ''
    const head = line.slice(0, out.cursor.col)
    const tail = line.slice(out.cursor.col)
    out.lines.splice(out.cursor.row, 1, head, tail)
    out.cursor = { row: out.cursor.row + 1, col: 0 }
    return out
  }
  const line = out.lines[out.cursor.row] ?? ''
  out.lines[out.cursor.row] = line.slice(0, out.cursor.col) + ch + line.slice(out.cursor.col)
  out.cursor.col += 1
  return out
}

function backspaceAtCursor(b: Buffer): Buffer {
  const out = cloneBuffer(b)
  if (out.cursor.col === 0) {
    if (out.cursor.row === 0) return out
    const prev = out.lines[out.cursor.row - 1] ?? ''
    const cur = out.lines[out.cursor.row] ?? ''
    const merged = prev + cur
    out.lines.splice(out.cursor.row - 1, 2, merged)
    out.cursor = { row: out.cursor.row - 1, col: prev.length }
    return out
  }
  const line = out.lines[out.cursor.row] ?? ''
  out.lines[out.cursor.row] = line.slice(0, out.cursor.col - 1) + line.slice(out.cursor.col)
  out.cursor.col -= 1
  return out
}

/** Map a single normal-mode keystroke (after any pending) to motion/op/etc. */
function normalKey(state: State, key: Key): State {
  if (key.kind === 'esc') return { ...state, pending: null }

  if (state.pending?.awaitingG) {
    if (key.kind === 'char' && key.ch === 'g') {
      const cursor = applyMotion(state.buffer, { kind: 'gg' })
      return { ...state, buffer: { ...cloneBuffer(state.buffer), cursor }, pending: null }
    }
    return { ...state, pending: null }
  }

  if (state.pending?.awaitingTextObj && state.pending.op !== undefined) {
    // We're in `<op>i` waiting for the object char.
    if (key.kind !== 'char') return { ...state, pending: null }
    let obj: TextObject | null = null
    if (key.ch === 'w') obj = { kind: 'iw' }
    else if (key.ch === '"') obj = { kind: 'i"' }
    else if (key.ch === '(' || key.ch === ')') obj = { kind: 'i(' }
    if (!obj) return { ...state, pending: null }
    const r = rangeFromTextObject(state.buffer, obj)
    if (!r) return { ...state, pending: null }
    const res = applyOperator(state.buffer, state.pending.op, r)
    return {
      ...state,
      buffer: res.buffer,
      register: res.yanked || state.register,
      pending: null,
      lastAction: { kind: 'op-textobj', op: state.pending.op, obj },
    }
  }

  if (state.pending?.op !== undefined) {
    // We've consumed an operator, now need a motion (or `i` for text-obj, or repeat for linewise).
    if (key.kind !== 'char') return { ...state, pending: null }
    const ch = key.ch

    // Linewise: dd / cc / yy
    if ((state.pending.op === 'd' && ch === 'd') ||
        (state.pending.op === 'c' && ch === 'c') ||
        (state.pending.op === 'y' && ch === 'y')) {
      const res = applyOperatorLinewise(state.buffer, state.pending.op)
      return {
        ...state,
        buffer: res.buffer,
        register: res.yanked || state.register,
        pending: null,
        lastAction: { kind: 'op-line', op: state.pending.op },
      }
    }

    // Text-object prefix
    if (ch === 'i') {
      return { ...state, pending: { ...state.pending, awaitingTextObj: true } }
    }

    // Motion
    const motion = charToMotion(ch)
    if (!motion) return { ...state, pending: null }
    if (motion.kind === 'gg') {
      // operator + gg requires another g
      // Not supported in this subset — bail.
      return { ...state, pending: null }
    }
    const r = rangeFromMotion(state.buffer, motion)
    if (!r) return { ...state, pending: null }
    const res = applyOperator(state.buffer, state.pending.op, r)
    return {
      ...state,
      buffer: res.buffer,
      register: res.yanked || state.register,
      pending: null,
      lastAction: { kind: 'op-motion', op: state.pending.op, motion },
    }
  }

  // No pending — handle a top-level normal-mode key.
  if (key.kind !== 'char') return state
  const ch = key.ch

  // Operators
  if (ch === 'd' || ch === 'c' || ch === 'y') {
    return { ...state, pending: { op: ch as OperatorKind } }
  }

  // Motions
  if (ch === 'g') {
    return { ...state, pending: { awaitingG: true } }
  }
  const motion = charToMotion(ch)
  if (motion) {
    const cursor = applyMotion(state.buffer, motion)
    return { ...state, buffer: { ...cloneBuffer(state.buffer), cursor } }
  }

  // Insert/append
  if (ch === 'i') {
    const b = cloneBuffer(state.buffer); b.mode = 'insert'
    return { ...state, buffer: b, insertBuffer: '' }
  }
  if (ch === 'a') {
    const b = cloneBuffer(state.buffer)
    const line = b.lines[b.cursor.row] ?? ''
    if (b.cursor.col < line.length) b.cursor.col += 1
    b.mode = 'insert'
    return { ...state, buffer: b, insertBuffer: '' }
  }
  if (ch === 'o') {
    const b = cloneBuffer(state.buffer)
    b.lines.splice(b.cursor.row + 1, 0, '')
    b.cursor = { row: b.cursor.row + 1, col: 0 }
    b.mode = 'insert'
    return { ...state, buffer: b, insertBuffer: '' }
  }
  if (ch === 'O') {
    const b = cloneBuffer(state.buffer)
    b.lines.splice(b.cursor.row, 0, '')
    b.cursor = { row: b.cursor.row, col: 0 }
    b.mode = 'insert'
    return { ...state, buffer: b, insertBuffer: '' }
  }

  // x / s
  if (ch === 'x') {
    const b = deleteCharUnderCursor(state.buffer)
    return { ...state, buffer: b, lastAction: { kind: 'x' } }
  }
  if (ch === 's') {
    const b = deleteCharUnderCursor(state.buffer); b.mode = 'insert'
    return { ...state, buffer: b, lastAction: { kind: 's' }, insertBuffer: '' }
  }

  // Paste
  if (ch === 'p') {
    const b = pasteAfter(state.buffer, state.register)
    return { ...state, buffer: b, lastAction: { kind: 'paste' } }
  }

  // Visual
  if (ch === 'v') {
    const b = cloneBuffer(state.buffer); b.mode = 'visual'
    return { ...state, buffer: b }
  }

  // Repeat
  if (ch === '.' && state.lastAction) {
    return replay(state, state.lastAction)
  }

  return state
}

function charToMotion(ch: string): Motion | null {
  switch (ch) {
    case 'h': return { kind: 'h' }
    case 'l': return { kind: 'l' }
    case 'j': return { kind: 'j' }
    case 'k': return { kind: 'k' }
    case 'w': return { kind: 'w' }
    case 'b': return { kind: 'b' }
    case '0': return { kind: '0' }
    case '$': return { kind: '$' }
    case 'G': return { kind: 'G' }
    default: return null
  }
}

/** Visual-mode handling: extend the cursor via motions, apply operator on op key. */
function visualKey(state: State, key: Key): State {
  if (key.kind === 'esc') {
    const b = cloneBuffer(state.buffer); b.mode = 'normal'
    return { ...state, buffer: b }
  }
  if (key.kind !== 'char') return state
  const ch = key.ch
  // Track an anchor implicitly via lastAction? Simpler: visual selects from
  // entry-cursor → motion-cursor by re-running the motion each key.
  const motion = charToMotion(ch)
  if (motion) {
    const cursor = applyMotion(state.buffer, motion)
    return { ...state, buffer: { ...cloneBuffer(state.buffer), cursor } }
  }
  if (ch === 'd' || ch === 'c' || ch === 'y') {
    // For our subset: visual op currently spans from the start of the line up to cursor in the
    // common test case `v$d`. We use a simple model: range = (cursor-anchor) where anchor is col 0
    // unless the user moved up first. To keep this minimal & correct for the spec acceptance,
    // we treat the visual range as (entry → current cursor) — entry tracked via `pending.anchor`.
    const anchorRow = (state.pending as any)?.anchorRow ?? state.buffer.cursor.row
    const anchorCol = (state.pending as any)?.anchorCol ?? state.buffer.cursor.col
    const a = { row: anchorRow, col: anchorCol }
    const c = state.buffer.cursor
    let s = a, e = c
    if (s.row > e.row || (s.row === e.row && s.col > e.col)) { s = c; e = a }
    // Make end inclusive (visual selection)
    const line = state.buffer.lines[e.row] ?? ''
    const endColInclusive = Math.min(line.length, e.col + 1)
    const range = { startRow: s.row, startCol: s.col, endRow: e.row, endCol: endColInclusive }
    const res = applyOperator(state.buffer, ch as OperatorKind, range)
    const next = cloneBuffer(res.buffer); next.mode = ch === 'c' ? 'insert' : 'normal'
    return {
      ...state,
      buffer: next,
      register: res.yanked || state.register,
      pending: null,
    }
  }
  return state
}

/** Process a key in insert mode. Esc returns to normal and finalizes lastAction. */
function insertKey(state: State, key: Key): State {
  if (key.kind === 'esc') {
    const b = cloneBuffer(state.buffer)
    b.mode = 'normal'
    // step cursor left like vim does
    b.cursor.col = Math.max(0, b.cursor.col - 1)
    const lastAction: RepeatAction | null = state.insertBuffer.length > 0
      ? { kind: 'insert', text: state.insertBuffer }
      : state.lastAction
    return { ...state, buffer: clampCursor(b), insertBuffer: '', lastAction }
  }
  if (key.kind === 'enter') {
    return {
      ...state,
      buffer: insertCharAtCursor(state.buffer, '\n'),
      insertBuffer: state.insertBuffer + '\n',
    }
  }
  if (key.kind === 'backspace') {
    return {
      ...state,
      buffer: backspaceAtCursor(state.buffer),
      insertBuffer: state.insertBuffer.slice(0, -1),
    }
  }
  // char
  return {
    ...state,
    buffer: insertCharAtCursor(state.buffer, key.ch),
    insertBuffer: state.insertBuffer + key.ch,
  }
}

/** Top-level reducer. */
export function step(state: State, key: Key): State {
  // On entering visual via `v`, capture the anchor in `pending`.
  if (state.buffer.mode === 'normal' && key.kind === 'char' && key.ch === 'v') {
    const b = cloneBuffer(state.buffer); b.mode = 'visual'
    return {
      ...state,
      buffer: b,
      pending: { ...(state.pending ?? {}), ...({ anchorRow: b.cursor.row, anchorCol: b.cursor.col } as any) },
    }
  }
  switch (state.buffer.mode) {
    case 'insert': return insertKey(state, key)
    case 'normal': return normalKey(state, key)
    case 'visual': return visualKey(state, key)
  }
}

/** Convenience: apply a sequence of keys (each char in `keys` is a normal char unless special). */
export function steps(state: State, keys: string): State {
  let s = state
  for (let i = 0; i < keys.length; i++) {
    const ch = keys[i]!
    if (ch === '\u001b') s = step(s, { kind: 'esc' })
    else if (ch === '\n') s = step(s, { kind: 'enter' })
    else if (ch === '\b') s = step(s, { kind: 'backspace' })
    else s = step(s, { kind: 'char', ch })
  }
  return s
}
