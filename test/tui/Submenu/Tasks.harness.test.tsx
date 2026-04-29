// test/tui/Submenu/Tasks.harness.test.tsx
//
// Phase 13 M4 — TasksSubmenu harness tests.
//
// Opens the tasks submenu directly via dispatchUI and asserts focused item
// details are rendered correctly.

import React from 'react'
import { describe, it, expect } from 'vitest'
import { mountApp } from '../../../src/tui/testing/harness'
import { createTodoStore } from '../../../src/core/tools/todoWrite'
import { App } from '../../../src/tui/App'
import { makeMinimalAppDeps } from '../../../src/tui/testing/harness'
import { render } from 'ink-testing-library'
import { TasksSubmenu } from '../../../src/tui/Submenu/TasksSubmenu'
import { ThemeProvider } from '../../../src/core/theme/context'
import { resolveTheme } from '../../../src/core/theme/themes'
import type { Message } from '../../../src/core/message/types'

const wait = (ms = 40) => new Promise(r => setTimeout(r, ms))

const theme = resolveTheme('default-dark')

function renderSubmenu(props: React.ComponentProps<typeof TasksSubmenu>) {
  const node = React.createElement(ThemeProvider, { theme },
    React.createElement(TasksSubmenu, props)
  )
  return render(node)
}

describe('TasksSubmenu (M4 harness)', () => {
  it('renders plan item detail for focusItem 0', () => {
    const store = createTodoStore()
    store.items = [
      { title: 'Implement auth', status: 'in_progress' },
      { title: 'Write docs', status: 'pending' },
    ]
    const inst = renderSubmenu({
      focusItem: 0,
      todoStore: store,
      messages: [],
      tasks: [],
    })
    try {
      const frame = (inst as unknown as { lastFrame: () => string }).lastFrame() ?? ''
      expect(frame).toContain('Plan item 1 of 2')
      expect(frame).toContain('Implement auth')
      expect(frame).toContain('in progress')
    } finally {
      inst.unmount()
    }
  })

  it('renders second plan item when focusItem=1', () => {
    const store = createTodoStore()
    store.items = [
      { title: 'First task', status: 'completed' },
      { title: 'Second task', status: 'pending' },
    ]
    const inst = renderSubmenu({
      focusItem: 1,
      todoStore: store,
      messages: [],
      tasks: [],
    })
    try {
      const frame = (inst as unknown as { lastFrame: () => string }).lastFrame() ?? ''
      expect(frame).toContain('Plan item 2 of 2')
      expect(frame).toContain('Second task')
      expect(frame).toContain('pending')
    } finally {
      inst.unmount()
    }
  })

  it('renders empty state when no tasks', () => {
    const store = createTodoStore()
    const inst = renderSubmenu({
      focusItem: 0,
      todoStore: store,
      messages: [],
      tasks: [],
    })
    try {
      const frame = (inst as unknown as { lastFrame: () => string }).lastFrame() ?? ''
      expect(frame).toContain('No tasks')
    } finally {
      inst.unmount()
    }
  })

  it('renders background task detail when focusItem points to bg task', () => {
    const store = createTodoStore()
    // No plan items, no subagents → bgTask is at index 0
    const tasks = [
      {
        id: 'bg-1',
        description: 'Run linter',
        state: 'running' as const,
        kind: 'shell' as const,
        outputFile: '/tmp/lint-output.txt',
        pid: 1234,
        cmd: 'eslint .',
        createdAt: Date.now(),
      },
    ]
    const inst = renderSubmenu({
      focusItem: 0,
      todoStore: store,
      messages: [],
      tasks,
    })
    try {
      const frame = (inst as unknown as { lastFrame: () => string }).lastFrame() ?? ''
      expect(frame).toContain('Background task 1 of 1')
      expect(frame).toContain('Run linter')
      expect(frame).toContain('/tmp/lint-output.txt')
    } finally {
      inst.unmount()
    }
  })

  it('full app: tasks submenu renders via Enter in focus mode', async () => {
    const store = createTodoStore()
    store.items = [
      { title: 'Deploy to production', status: 'pending' },
    ]
    const h = mountApp({ target: 'app', todoStore: store })
    try {
      await wait()
      // Enter focus mode.
      h.stdin.write('\t')
      await wait()
      // Open submenu.
      h.stdin.write('\r')
      await wait(80)
      const frame = h.frames().pop() ?? ''
      expect(frame).toContain('Tasks')
      expect(frame).toContain('Plan item')
      expect(frame).toContain('Deploy to production')
      // Esc closes submenu.
      h.stdin.write('\u001b')
      await wait()
      const after = h.frames().pop() ?? ''
      expect(after).not.toContain('Plan item')
    } finally {
      h.unmount()
    }
  })
})
