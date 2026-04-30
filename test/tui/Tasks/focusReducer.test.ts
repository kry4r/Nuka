// test/tui/Tasks/focusReducer.test.ts
import { describe, it, expect } from 'vitest'
import { focusReducer, initialFocus } from '../../../src/tui/Tasks/focusReducer'

describe('focusReducer', () => {
  const cols = ['plan','subagent','pipeline','background','message'] as const

  it('Tab from prompt → plan', () => {
    expect(focusReducer(initialFocus(), { type: 'tab' })).toEqual({ kind: 'tasks-column', column: 'plan', selectedIndex: 0 })
  })
  it('Tab cycles columns', () => {
    let s = initialFocus()
    for (const c of cols) {
      s = focusReducer(s, { type: 'tab' })
      expect(s.kind).toBe('tasks-column')
      expect((s as any).column).toBe(c)
    }
    s = focusReducer(s, { type: 'tab' })
    expect(s.kind).toBe('prompt')
  })
  it('Down moves selectedIndex within column', () => {
    let s: any = focusReducer(initialFocus(), { type: 'tab' })
    s = focusReducer(s, { type: 'down' })
    expect(s.selectedIndex).toBe(1)
  })
  it('Enter transitions to tasks-row', () => {
    let s: any = focusReducer(initialFocus(), { type: 'tab' })
    s = focusReducer(s, { type: 'enter', rowId: 'r1' })
    expect(s).toEqual({ kind: 'tasks-row', column: 'plan', rowId: 'r1' })
  })
  it('Esc from tasks-row returns to tasks-column', () => {
    const s: any = focusReducer({ kind: 'tasks-row', column: 'plan', rowId: 'r1' }, { type: 'esc' })
    expect(s).toEqual({ kind: 'tasks-column', column: 'plan', selectedIndex: 0 })
  })
  it('Esc from tasks-column returns to prompt', () => {
    const s: any = focusReducer({ kind: 'tasks-column', column: 'plan', selectedIndex: 0 }, { type: 'esc' })
    expect(s).toEqual({ kind: 'prompt' })
  })
})
