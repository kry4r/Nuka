// test/tui/Tasks/TasksPanel.test.tsx
//
// Phase 12 M3 — unit tests for TasksPanel component.
//
// Tests the all-empty → hidden logic and the three-section render.

import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import stripAnsi from 'strip-ansi'
import { TasksPanel } from '../../../src/tui/Tasks/TasksPanel'
import type { TodoState } from '../../../src/core/tools/todoWrite'
import type { Task } from '../../../src/core/tasks/types'
import { DISPATCH_AGENT_TOOL_NAME } from '../../../src/core/agents/dispatchTool'

const emptyStore: TodoState = { items: [] }
const emptyMessages = [] as const
const emptyTasks: Task[] = []

describe('TasksPanel', () => {
  it('returns null when all sections are empty', () => {
    const { lastFrame } = render(
      React.createElement(TasksPanel, {
        todoStore: emptyStore,
        messages: emptyMessages,
        tasks: emptyTasks,
        tick: 0,
        collapsed: false,
      })
    )
    expect(lastFrame()).toBe('')
  })

  it('renders Plan section only when only todoStore has items', () => {
    const store: TodoState = {
      items: [{ title: 'Do the thing', status: 'in_progress' }],
    }
    const { lastFrame } = render(
      React.createElement(TasksPanel, {
        todoStore: store,
        messages: emptyMessages,
        tasks: emptyTasks,
        tick: 0,
        collapsed: false,
      })
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('Plan')
    expect(f).toContain('Do the thing')
    expect(f).not.toContain('Subagents')
    expect(f).not.toContain('Backgrounds')
  })

  it('renders Backgrounds section only when only tasks are present', () => {
    const task: Task = {
      id: 't1',
      kind: 'local_bash',
      description: 'background task',
      state: 'running',
      outputFile: '/tmp/t1.log',
      spec: { kind: 'local_bash', description: 'background task', command: 'sleep 10' },
    }
    const { lastFrame } = render(
      React.createElement(TasksPanel, {
        todoStore: emptyStore,
        messages: emptyMessages,
        tasks: [task],
        tick: 0,
        collapsed: false,
      })
    )
    const f = lastFrame() ?? ''
    expect(f).not.toContain('Plan')
    expect(f).not.toContain('Subagents')
    expect(f).toContain('Backgrounds')
    expect(f).toContain('background task')
  })

  it('renders all three sections when all have data', () => {
    const store: TodoState = { items: [{ title: 'plan item', status: 'pending' }] }
    const messages = [
      {
        role: 'assistant' as const,
        content: [{
          type: 'tool_use' as const,
          id: 'da-1',
          name: DISPATCH_AGENT_TOOL_NAME,
          input: { agent: 'x:y', task: 'subagent task' },
        }],
        id: 'msg-1',
        ts: Date.now(),
      },
    ]
    const task: Task = {
      id: 't1',
      kind: 'local_bash',
      description: 'bg task',
      state: 'running',
      outputFile: '/tmp/t1.log',
      spec: { kind: 'local_bash', description: 'bg task', command: 'sleep 5' },
    }
    const { lastFrame } = render(
      React.createElement(TasksPanel, {
        todoStore: store,
        messages,
        tasks: [task],
        tick: 0,
        collapsed: false,
      })
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('Plan')
    expect(f).toContain('Subagents')
    expect(f).toContain('Backgrounds')
  })

  it('shows Ctrl+T hint in the panel header', () => {
    const store: TodoState = { items: [{ title: 'x', status: 'pending' }] }
    const { lastFrame } = render(
      React.createElement(TasksPanel, {
        todoStore: store,
        messages: emptyMessages,
        tasks: emptyTasks,
        tick: 0,
        collapsed: false,
      })
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('Tasks')
    expect(f).toContain('Ctrl+T')
  })

  it('contains pathological plan / subagent / background labels within column-aware width (no border bleed)', () => {
    const orig = process.stdout.columns
    Object.defineProperty(process.stdout, 'columns', { value: 60, configurable: true })
    try {
      const huge = 'a'.repeat(5000)            // 5KB no-space title
      const url = 'https://example.com/' + 'x'.repeat(300)
      const store: TodoState = {
        items: [
          { title: huge, status: 'in_progress' },
          { title: url, status: 'pending' },
        ],
      }
      const messages = [
        {
          role: 'assistant' as const,
          content: [{
            type: 'tool_use' as const,
            id: 'da-1',
            name: DISPATCH_AGENT_TOOL_NAME,
            input: { agent: 'team:role', task: huge },
          }],
          id: 'msg-1',
          ts: Date.now(),
        },
      ]
      const task: Task = {
        id: 't1',
        kind: 'local_bash',
        description: url,
        state: 'running',
        outputFile: '/tmp/t1.log',
        spec: { kind: 'local_bash', description: url, command: 'sleep 5' },
      }
      const { lastFrame } = render(
        React.createElement(TasksPanel, {
          todoStore: store,
          messages,
          tasks: [task],
          tick: 0,
          collapsed: false,
        })
      )
      const f = stripAnsi(lastFrame() ?? '')
      const maxLine = Math.max(...f.split('\n').map(s => s.length))
      expect(maxLine).toBeLessThanOrEqual(60)
    } finally {
      Object.defineProperty(process.stdout, 'columns', { value: orig, configurable: true })
    }
  })
})
