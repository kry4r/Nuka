// test/ui-auto/fixtures/iter-10-agent-call-cjk-task.fixtures.tsx
//
// Iter-10 sweep: AgentCall collapsed task summary at narrow viewports.
//
// Coverage rationale:
//   AgentCall already display-width truncates result text inside the expanded
//   result box, but its collapsed task summary still uses code-unit length
//   and slice() on an unbounded header row. A long CJK task must be bounded
//   by terminal display width and show an ellipsis inside narrow viewports.

import React from 'react'
import { AgentCall } from '../../../src/tui/Messages/AgentCall'
import type { FixtureDef } from '../../../src/core/testing/explorer/types'

const fixture: FixtureDef = {
  component: 'AgentCallCjkTask',
  viewports: [
    { cols: 60, rows: 30 },
    { cols: 70, rows: 30 },
  ],
  cases: {
    'cjk-collapsed-task-stays-inside-header': {
      render: () => (
        <AgentCall
          agent="core:reviewer"
          task={'一'.repeat(80)}
          status="running"
          expanded={false}
        />
      ),
      mustContain: ['…'],
    },
  },
}

export default fixture
