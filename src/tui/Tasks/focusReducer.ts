// src/tui/Tasks/focusReducer.ts
export type ColumnKind = 'plan' | 'subagent' | 'pipeline' | 'background' | 'message'
const ORDER: ColumnKind[] = ['plan', 'subagent', 'pipeline', 'background', 'message']

export type FocusState =
  | { kind: 'prompt' }
  | { kind: 'tasks-column'; column: ColumnKind; selectedIndex: number }
  | { kind: 'tasks-row'; column: ColumnKind; rowId: string }

export type FocusEvent =
  | { type: 'tab' }
  | { type: 'shift-tab' }
  | { type: 'up' }
  | { type: 'down' }
  | { type: 'enter'; rowId?: string }
  | { type: 'esc' }

export const initialFocus = (): FocusState => ({ kind: 'prompt' })

export function focusReducer(state: FocusState, e: FocusEvent): FocusState {
  if (e.type === 'tab') {
    if (state.kind === 'prompt') return { kind: 'tasks-column', column: ORDER[0]!, selectedIndex: 0 }
    if (state.kind === 'tasks-column') {
      const idx = ORDER.indexOf(state.column)
      const next = ORDER[idx + 1]
      return next ? { kind: 'tasks-column', column: next, selectedIndex: 0 } : { kind: 'prompt' }
    }
    return state
  }
  if (e.type === 'shift-tab') {
    if (state.kind === 'prompt') return { kind: 'tasks-column', column: ORDER[ORDER.length - 1]!, selectedIndex: 0 }
    if (state.kind === 'tasks-column') {
      const idx = ORDER.indexOf(state.column)
      const prev = ORDER[idx - 1]
      return prev ? { kind: 'tasks-column', column: prev, selectedIndex: 0 } : { kind: 'prompt' }
    }
    return state
  }
  if (e.type === 'down' && state.kind === 'tasks-column') return { ...state, selectedIndex: state.selectedIndex + 1 }
  if (e.type === 'up' && state.kind === 'tasks-column') return { ...state, selectedIndex: Math.max(0, state.selectedIndex - 1) }
  if (e.type === 'enter' && state.kind === 'tasks-column' && e.rowId) return { kind: 'tasks-row', column: state.column, rowId: e.rowId }
  if (e.type === 'esc') {
    if (state.kind === 'tasks-row') return { kind: 'tasks-column', column: state.column, selectedIndex: 0 }
    if (state.kind === 'tasks-column') return { kind: 'prompt' }
  }
  return state
}
