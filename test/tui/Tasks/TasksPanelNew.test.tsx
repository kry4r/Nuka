// test/tui/Tasks/TasksPanelNew.test.tsx
// Deviation from plan: TasksPanel renamed to TasksPanelNew to avoid breaking
// existing test/tui/Tasks/TasksPanel.test.tsx which tests the legacy API.
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import * as React from 'react'
import { TasksPanelNew } from '../../../src/tui/Tasks/TasksPanelNew'
import { initialColumns } from '../../../src/tui/Tasks/columnReducer'

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

  it('narrow terminal collapses to single column', () => {
    const out = render(<TasksPanelNew state={initialColumns()} focus={{ kind: 'prompt' }} cols={80} />).lastFrame() ?? ''
    expect(out.toLowerCase()).toContain('[plan|sub|pipe|bg|msg]')
  })
})
