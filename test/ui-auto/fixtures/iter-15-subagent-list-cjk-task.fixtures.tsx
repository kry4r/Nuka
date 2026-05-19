// test/ui-auto/fixtures/iter-15-subagent-list-cjk-task.fixtures.tsx
//
// Iter-15 sweep: in-flight subagent task labels at narrow viewports.
//
// Coverage rationale:
//   SubagentList derives labels from dispatch_agent input.task using
//   code-unit slice/length. A CJK-heavy task must be bounded by terminal
//   display width and show an ellipsis instead of wrapping the row.

import React from 'react'
import { SubagentList } from '../../../src/tui/Tasks/SubagentList'
import { DISPATCH_AGENT_TOOL_NAME } from '../../../src/core/agents/dispatchTool'
import type { Message } from '../../../src/core/message/types'
import type { FixtureDef } from '../../../src/core/testing/explorer/types'

const messages: Message[] = [
  {
    role: 'assistant',
    id: 'assistant-iter-15',
    ts: 0,
    content: [
      {
        type: 'tool_use',
        id: 'dispatch-iter-15',
        name: DISPATCH_AGENT_TOOL_NAME,
        input: {
          agent: 'test:agent',
          task: '一'.repeat(42),
        },
      },
    ],
  },
]

const fixture: FixtureDef = {
  component: 'SubagentListCjkTask',
  viewports: [
    { cols: 60, rows: 30 },
    { cols: 70, rows: 30 },
  ],
  cases: {
    'cjk-task-label-truncates-by-display-width': {
      render: () => (
        <SubagentList
          messages={messages}
          maxItems={5}
        />
      ),
      mustContain: ['…'],
    },
  },
}

export default fixture
