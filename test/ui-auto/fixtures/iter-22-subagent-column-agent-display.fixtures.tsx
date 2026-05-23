// test/ui-auto/fixtures/iter-22-subagent-column-agent-display.fixtures.tsx
//
// Coverage: local subagent rows should show the agent display name plus
// compact task/id context at narrow widths.

import React from 'react'
import { TasksPanelNew } from '../../../src/tui/Tasks/TasksPanelNew'
import type { ColumnsState } from '../../../src/tui/Tasks/columnReducer'
import { initialColumns } from '../../../src/tui/Tasks/columnReducer'
import type { FixtureDef } from '../../../src/core/testing/explorer/types'

const state: ColumnsState = {
  ...initialColumns(),
  subagent: {
    rows: [{
      id: 'task-agent-display',
      primary: 'core:verifier',
      secondary: 'review CJK layout 一二三四五六 · agent-1234abcd',
      status: 'running',
      agentName: 'core:verifier',
      agentId: 'agent-1234abcd',
      colorKey: 'agent-2',
    }],
  },
}

const fixture: FixtureDef = {
  component: 'SubagentColumnAgentDisplay',
  viewports: [
    { cols: 80, rows: 24 },
    { cols: 100, rows: 24 },
  ],
  cases: {
    'shows-agent-name-and-context': {
      render: () => (
        <TasksPanelNew
          state={state}
          focus={{ kind: 'tasks-column', column: 'subagent', selectedIndex: 0 }}
          cols={80}
        />
      ),
      mustContain: ['core:verifier', 'review CJK layout', 'agent-1234abcd'],
    },
  },
}

export default fixture
