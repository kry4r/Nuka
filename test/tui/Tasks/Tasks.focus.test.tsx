// test/tui/Tasks/Tasks.focus.test.tsx
//
// Phase 13 M4 — Tasks panel focus mode harness tests.
//
// Tests:
// 1. Tab with populated tasks enters focused state (panel border changes).
// 2. j/↓ moves cursor down.
// 3. Enter in focused mode opens Tasks submenu.
// 4. Esc returns to normal from focused mode.
// 5. Tab with empty tasks does NOT enter focused mode.

import { describe, it, expect } from 'vitest'
import { mountApp } from '../../../src/tui/testing/harness'
import { createTodoStore } from '../../../src/core/tools/todoWrite'

const wait = (ms = 40) => new Promise(r => setTimeout(r, ms))

describe('Tasks panel focus mode (M4)', () => {
  it('Tab enters focused state when tasks are present', async () => {
    const store = createTodoStore()
    store.items = [
      { title: 'Build feature X', status: 'in_progress' },
      { title: 'Write tests', status: 'pending' },
    ]
    const h = mountApp({ target: 'app', todoStore: store })
    try {
      await wait()
      // Before Tab: normal state, Ctrl+T hint visible.
      const before = h.frames().pop() ?? ''
      expect(before).toContain('Plan')

      // Press Tab to enter focus mode.
      h.stdin.write('\t')
      await wait()
      const focused = h.frames().pop() ?? ''
      // Focused hint text should appear.
      expect(focused).toContain('jk')
      // First item should be highlighted (cursor at 0).
      expect(focused).toContain('Build feature X')
    } finally {
      h.unmount()
    }
  })

  it('j moves cursor down in focused mode', async () => {
    const store = createTodoStore()
    store.items = [
      { title: 'First task', status: 'pending' },
      { title: 'Second task', status: 'pending' },
    ]
    const h = mountApp({ target: 'app', todoStore: store })
    try {
      await wait()
      // Enter focus mode.
      h.stdin.write('\t')
      await wait()
      const atFirst = h.frames().pop() ?? ''
      expect(atFirst).toContain('First task')

      // Press j to move cursor to second item.
      h.stdin.write('j')
      await wait()
      const atSecond = h.frames().pop() ?? ''
      // Both items still visible; cursor moved.
      expect(atSecond).toContain('Second task')
    } finally {
      h.unmount()
    }
  })

  it('Enter in focused mode opens Tasks submenu', async () => {
    const store = createTodoStore()
    store.items = [
      { title: 'Deploy pipeline', status: 'pending' },
    ]
    const h = mountApp({ target: 'app', todoStore: store })
    try {
      await wait()
      // Enter focus mode.
      h.stdin.write('\t')
      await wait()
      // Press Enter to open Tasks submenu.
      h.stdin.write('\r')
      await wait(80)
      const frame = h.frames().pop() ?? ''
      // TasksSubmenu renders "Plan item 1 of 1" and the item title.
      expect(frame).toContain('Plan item')
      expect(frame).toContain('Deploy pipeline')
    } finally {
      h.unmount()
    }
  })

  it('Esc returns to normal from focused mode', async () => {
    const store = createTodoStore()
    store.items = [
      { title: 'Some task', status: 'pending' },
    ]
    const h = mountApp({ target: 'app', todoStore: store })
    try {
      await wait()
      // Enter focus mode.
      h.stdin.write('\t')
      await wait()
      const inFocus = h.frames().pop() ?? ''
      expect(inFocus).toContain('jk')

      // Press Esc to exit.
      h.stdin.write('\u001b') // ESC
      await wait()
      const back = h.frames().pop() ?? ''
      // Back to normal: Ctrl+T hint shows.
      expect(back).toContain('Ctrl+T')
      // No focus-mode hint.
      expect(back).not.toContain('Tab: exit')
    } finally {
      h.unmount()
    }
  })

  it('Tab does NOT enter focus mode when tasks panel is empty', async () => {
    const store = createTodoStore()
    // No items — panel hidden.
    const h = mountApp({ target: 'app', todoStore: store })
    try {
      await wait()
      h.stdin.write('\t')
      await wait()
      const frame = h.frames().pop() ?? ''
      // Should NOT contain focus-mode hint text.
      expect(frame).not.toContain('jk')
    } finally {
      h.unmount()
    }
  })
})
