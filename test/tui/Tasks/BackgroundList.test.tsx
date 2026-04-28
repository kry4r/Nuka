// test/tui/Tasks/BackgroundList.test.tsx
//
// Phase 12 M3 — unit tests for BackgroundList component.

import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { BackgroundList } from '../../../src/tui/Tasks/BackgroundList'
import type { Task } from '../../../src/core/tasks/types'

function makeTask(id: string, state: Task['state'], description: string): Task {
  return {
    id,
    kind: 'local_bash',
    description,
    state,
    outputFile: `/tmp/${id}.log`,
    spec: { kind: 'local_bash', description, command: 'echo test' },
  }
}

describe('BackgroundList', () => {
  it('returns null when tasks array is empty', () => {
    const { lastFrame } = render(
      React.createElement(BackgroundList, { tasks: [], maxItems: 10 })
    )
    expect(lastFrame()).toBe('')
  })

  it('renders Backgrounds heading with task descriptions', () => {
    const tasks = [
      makeTask('t1', 'running', 'Build the project'),
      makeTask('t2', 'completed', 'Run tests'),
    ]
    const { lastFrame } = render(
      React.createElement(BackgroundList, { tasks, maxItems: 10 })
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('Backgrounds')
    expect(f).toContain('Build the project')
    expect(f).toContain('Run tests')
  })

  it('uses correct state icons for all task states', () => {
    const tasks = [
      makeTask('t1', 'running', 'running task'),
      makeTask('t2', 'completed', 'completed task'),
      makeTask('t3', 'failed', 'failed task'),
      makeTask('t4', 'killed', 'killed task'),
      makeTask('t5', 'pending', 'pending task'),
    ]
    const { lastFrame } = render(
      React.createElement(BackgroundList, { tasks, maxItems: 10 })
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('▶') // running
    expect(f).toContain('✓') // completed
    expect(f).toContain('✗') // failed
    expect(f).toContain('◉') // killed
    expect(f).toContain('☐') // pending
  })

  it('shows overflow ellipsis when tasks exceed maxItems', () => {
    const tasks = Array.from({ length: 6 }, (_, i) =>
      makeTask(`t${i}`, 'running', `task ${i}`)
    )
    const { lastFrame } = render(
      React.createElement(BackgroundList, { tasks, maxItems: 3 })
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('task 0')
    expect(f).toContain('task 2')
    expect(f).not.toContain('task 3')
    expect(f).toContain('… +3 more')
  })

  it('renders tasks of both kinds (local_bash and local_agent)', () => {
    const tasks: Task[] = [
      makeTask('t1', 'running', 'bash task'),
      {
        id: 't2',
        kind: 'local_agent',
        description: 'agent task',
        state: 'running',
        outputFile: '/tmp/t2.log',
        spec: {
          kind: 'local_agent',
          description: 'agent task',
          agentRunner: async function* () {},
        },
      },
    ]
    const { lastFrame } = render(
      React.createElement(BackgroundList, { tasks, maxItems: 10 })
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('bash task')
    expect(f).toContain('agent task')
  })
})
