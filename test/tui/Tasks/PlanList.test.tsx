// test/tui/Tasks/PlanList.test.tsx
//
// Phase 12 M3 — unit tests for PlanList component.

import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { PlanList } from '../../../src/tui/Tasks/PlanList'
import type { TodoState } from '../../../src/core/tools/todoWrite'

describe('PlanList', () => {
  it('returns null when store is empty', () => {
    const store: TodoState = { items: [] }
    const { lastFrame } = render(React.createElement(PlanList, { store, maxItems: 10 }))
    expect(lastFrame()).toBe('')
  })

  it('renders the Plan heading and all items within cap', () => {
    const store: TodoState = {
      items: [
        { title: 'First task', status: 'pending' },
        { title: 'Second task', status: 'in_progress' },
        { title: 'Third task', status: 'completed' },
      ],
    }
    const { lastFrame } = render(React.createElement(PlanList, { store, maxItems: 10 }))
    const f = lastFrame() ?? ''
    expect(f).toContain('Plan')
    expect(f).toContain('First task')
    expect(f).toContain('☐')
    expect(f).toContain('Second task')
    expect(f).toContain('▶')
    expect(f).toContain('Third task')
    expect(f).toContain('✓')
  })

  it('does NOT render a ✗ icon for any plan status', () => {
    const store: TodoState = {
      items: [
        { title: 'Task A', status: 'completed' },
        { title: 'Task B', status: 'pending' },
        { title: 'Task C', status: 'in_progress' },
      ],
    }
    const { lastFrame } = render(React.createElement(PlanList, { store, maxItems: 10 }))
    const f = lastFrame() ?? ''
    expect(f).not.toContain('✗')
  })

  it('shows overflow ellipsis when items exceed maxItems', () => {
    const store: TodoState = {
      items: Array.from({ length: 6 }, (_, i) => ({
        title: `item ${i}`,
        status: 'pending' as const,
      })),
    }
    const { lastFrame } = render(React.createElement(PlanList, { store, maxItems: 3 }))
    const f = lastFrame() ?? ''
    expect(f).toContain('item 0')
    expect(f).toContain('item 2')
    expect(f).not.toContain('item 3')
    expect(f).toContain('… +3 more')
  })

  it('does not show overflow ellipsis when items exactly match maxItems', () => {
    const store: TodoState = {
      items: [
        { title: 'A', status: 'pending' },
        { title: 'B', status: 'pending' },
      ],
    }
    const { lastFrame } = render(React.createElement(PlanList, { store, maxItems: 2 }))
    const f = lastFrame() ?? ''
    expect(f).not.toContain('… +')
  })
})
