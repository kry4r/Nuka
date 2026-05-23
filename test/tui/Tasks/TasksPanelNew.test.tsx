// test/tui/Tasks/TasksPanelNew.test.tsx
// Deviation from plan: TasksPanel renamed to TasksPanelNew to avoid breaking
// existing test/tui/Tasks/TasksPanel.test.tsx which tests the legacy API.
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import * as React from 'react'
import { TasksPanelNew } from '../../../src/tui/Tasks/TasksPanelNew'
import { initialColumns, type ColumnsState } from '../../../src/tui/Tasks/columnReducer'
import { renderWithViewport } from '../../../src/core/testing/explorer/L0/render'

const flushInk = async (): Promise<void> => {
  await new Promise(r => setImmediate(r))
  await new Promise(r => setImmediate(r))
}

function populatedColumns(): ColumnsState {
  return {
    plan: {
      rows: [{ id: 'plan-1', primary: 'Track 4: simplify task panel', secondary: 'human TUI redesign', status: 'running' }],
    },
    subagent: {
      rows: [{
        id: 'sub-1',
        primary: 'core:verifier',
        secondary: 'review provider/statusline layout - agent-1234abcd',
        status: 'running',
        agentName: 'core:verifier',
        agentId: 'agent-1234abcd',
        colorKey: 'agent-3',
      }],
    },
    pipeline: {
      rows: [{ id: 'pipe-1', primary: 'compact audit', secondary: 'responses fallback', status: 'pending' }],
    },
    background: {
      rows: [{ id: 'bg-1', primary: 'npm test', secondary: 'selected regression suite', status: 'running' }],
    },
    message: {
      rows: [{ id: 'msg-1', primary: 'user -> core:planner', secondary: 'statusline redesign checklist', status: 'sent' }],
    },
  }
}

describe('TasksPanel layout', () => {
  it('wide terminal renders a plain digest instead of five bordered columns', async () => {
    const handle = renderWithViewport(
      <TasksPanelNew state={populatedColumns()} focus={{ kind: 'tasks-column', column: 'subagent', selectedIndex: 0 }} cols={120} />,
      { cols: 120, rows: 12 },
    )
    try {
      await flushInk()

      const out = handle.lastFrame() ?? ''
      expect(out).toContain('Tasks:')
      expect(out).toContain('plan 1')
      expect(out).toContain('sub 1')
      expect(out).toContain('Track 4')
      expect(out).toContain('core:verifier')
      expect(out).toContain('npm test')
      expect(out).not.toContain('╭')
      expect(out).not.toContain('╰')
    } finally {
      handle.unmount()
    }
  })

  it('wide terminal shows empty task slots without boxed chrome', async () => {
    const handle = renderWithViewport(
      <TasksPanelNew state={initialColumns()} focus={{ kind: 'prompt' }} cols={120} />,
      { cols: 120, rows: 12 },
    )
    try {
      await flushInk()

      const out = (handle.lastFrame() ?? '').toLowerCase()
      expect(out).toContain('tasks:')
      expect(out).toContain('plan 0')
      expect(out).toContain('msg 0')
      expect(out).toContain('(none)')
      expect(out).not.toContain('╭')
    } finally {
      handle.unmount()
    }
  })

  it('narrow terminal collapses to single column with row counts', () => {
    const out = render(<TasksPanelNew state={initialColumns()} focus={{ kind: 'prompt' }} cols={80} />).lastFrame() ?? ''
    const lower = out.toLowerCase()
    // Narrow mode uses a readable status summary instead of a dense tab strip.
    expect(lower).toContain('tasks:')
    expect(lower).toContain('plan 0')
    expect(lower).toContain('sub 0')
    expect(lower).toContain('pipe 0')
    expect(lower).toContain('bg 0')
    expect(lower).toContain('msg 0')
    expect(lower).not.toContain('[plan(')
  })

  it('renders subagent agent name with task context', () => {
    const state: ColumnsState = {
      ...initialColumns(),
      subagent: {
        rows: [{
          id: 't1',
          primary: 'core:verifier',
          secondary: 'review code · agent-1234abcd',
          status: 'running',
          agentName: 'core:verifier',
          agentId: 'agent-1234abcd',
          colorKey: 'agent-3',
        }],
      },
    }
    const out = render(<TasksPanelNew state={state} focus={{ kind: 'tasks-column', column: 'subagent', selectedIndex: 0 }} cols={80} />).lastFrame() ?? ''
    expect(out).toContain('core:verifier')
    expect(out).toContain('review code')
    expect(out).toContain('agent-1234abcd')
  })
})
