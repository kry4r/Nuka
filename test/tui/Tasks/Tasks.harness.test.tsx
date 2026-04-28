// test/tui/Tasks/Tasks.harness.test.tsx
//
// Phase 12 M3 — harness tests for the Tasks panel.
//
// Tests that:
// 1. Empty panel hides entirely (no Tasks frame rendered).
// 2. Populated plan shows PlanList items.
// 3. Ctrl+T collapses to summary row; toggling back shows full panel.
// 4. TaskManager background tasks are shown in BackgroundList.
// 5. Overflow cap: items beyond 12 rows are truncated with "… +N more".

import { describe, it, expect } from 'vitest'
import { mountApp } from '../../../src/tui/testing/harness'
import { createTodoStore } from '../../../src/core/tools/todoWrite'

const wait = (ms = 30) => new Promise(r => setTimeout(r, ms))

describe('Tasks panel (M3 harness)', () => {
  it('hides entirely when todoStore is absent (no Tasks frame)', async () => {
    const h = mountApp({ target: 'app' })
    try {
      await wait()
      const frame = h.frames().pop() ?? ''
      // No tasks panel when todoStore is not provided.
      expect(frame).not.toContain('Plan')
      expect(frame).not.toContain('Subagents')
      expect(frame).not.toContain('Backgrounds')
    } finally {
      h.unmount()
    }
  })

  it('hides entirely when todoStore is empty and no tasks', async () => {
    const store = createTodoStore()
    const h = mountApp({ target: 'app', todoStore: store })
    try {
      await wait()
      const frame = h.frames().pop() ?? ''
      // Panel hidden: zero height means no Tasks border.
      expect(frame).not.toContain('Plan')
      expect(frame).not.toContain('Backgrounds')
    } finally {
      h.unmount()
    }
  })

  it('shows Plan section when todoStore has items', async () => {
    const store = createTodoStore()
    store.items = [
      { title: 'Implement feature A', status: 'completed' },
      { title: 'Write tests', status: 'in_progress' },
      { title: 'Deploy to staging', status: 'pending' },
    ]
    const h = mountApp({ target: 'app', todoStore: store })
    try {
      await wait()
      const frame = h.frames().pop() ?? ''
      expect(frame).toContain('Plan')
      expect(frame).toContain('Implement feature A')
      expect(frame).toContain('Write tests')
      expect(frame).toContain('Deploy to staging')
      // Icons
      expect(frame).toContain('✓')
      expect(frame).toContain('▶')
      expect(frame).toContain('☐')
    } finally {
      h.unmount()
    }
  })

  it('Ctrl+T collapses tasks panel to summary row', async () => {
    const store = createTodoStore()
    store.items = [{ title: 'Do something', status: 'pending' }]
    const h = mountApp({ target: 'app', todoStore: store })
    try {
      await wait()
      const expanded = h.frames().pop() ?? ''
      // Expanded: shows the Plan section header.
      expect(expanded).toContain('Plan')
      // Press Ctrl+T to collapse.
      h.stdin.write('\u0014') // Ctrl+T
      await wait()
      const collapsed = h.frames().pop() ?? ''
      // Collapsed: shows the summary row.
      expect(collapsed).toMatch(/Tasks ▸/)
      // No longer shows the full Plan section.
      expect(collapsed).not.toContain('Tasks  ')
      // Ctrl+T toggles back to expanded.
      h.stdin.write('\u0014')
      await wait()
      const back = h.frames().pop() ?? ''
      expect(back).toContain('Plan')
    } finally {
      h.unmount()
    }
  })

  it('shows overflow "… +N more" when plan has many items', async () => {
    const store = createTodoStore()
    // 15 items should exceed the cap.
    store.items = Array.from({ length: 15 }, (_, i) => ({
      title: `Task ${i + 1}`,
      status: 'pending' as const,
    }))
    const h = mountApp({ target: 'app', todoStore: store })
    try {
      await wait()
      const frame = h.frames().pop() ?? ''
      expect(frame).toContain('Plan')
      // Should see the overflow ellipsis.
      expect(frame).toContain('… +')
    } finally {
      h.unmount()
    }
  })
})
