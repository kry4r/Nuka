// test/tui/Tasks/TasksPanelNew.test.tsx
// Deviation from plan: TasksPanel renamed to TasksPanelNew to avoid breaking
// existing test/tui/Tasks/TasksPanel.test.tsx which tests the legacy API.
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import * as React from 'react'
import { TasksPanelNew } from '../../../src/tui/Tasks/TasksPanelNew'
import { initialColumns, type ColumnsState } from '../../../src/tui/Tasks/columnReducer'

describe('TasksPanel layout', () => {
  it('renders 5 column headers', () => {
    const { lastFrame } = render(<TasksPanelNew state={initialColumns()} focus={{ kind: 'prompt' }} cols={120} />)
    const out = lastFrame() ?? ''
    expect(out).toContain('Plan')
    expect(out).toContain('Subagents')
    expect(out).toContain('Pipeline')
    expect(out).toContain('Backgrounds')
    expect(out).toContain('Messages')
  })

  it('shows (no <kind>) when column empty', () => {
    const out = (render(<TasksPanelNew state={initialColumns()} focus={{ kind: 'prompt' }} cols={120} />).lastFrame() ?? '')
    expect(out.toLowerCase()).toContain('no plan')
    expect(out.toLowerCase()).toContain('no message')
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
