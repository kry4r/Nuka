// test/ui-auto/fixtures/iter-8-subagent-detail-cjk-plan.fixtures.tsx
//
// Iter-8 sweep: SubagentDetail plan approval box at narrow explorer viewports.
//
// Coverage rationale:
//   SubagentDetail hard-cuts unbreakable plan lines before wrapping them inside
//   a nested approval box. A long CJK plan line must be display-width bounded
//   inside that box, not sliced by code units and rendered past the viewport.

import React from 'react'
import { SubagentDetail } from '../../../src/tui/Tasks/SubagentDetail'
import type { FixtureDef } from '../../../src/core/testing/explorer/types'

const noop = () => {}

const fixture: FixtureDef = {
  component: 'SubagentDetailCjkPlan',
  viewports: [
    { cols: 60, rows: 30 },
    { cols: 70, rows: 30 },
  ],
  cases: {
    'cjk-plan-line-stays-inside-approval-box': {
      render: () => (
        <SubagentDetail
          taskId="task-1"
          agentName="reviewer"
          teamName="core"
          status="awaiting-plan"
          conversation={[]}
          activities={[]}
          planAwaitingApproval={{
            plan: '一'.repeat(80),
            requestId: 'plan-1',
          }}
          onInjectMessage={noop}
          onPause={noop}
          onKill={noop}
          onShutdown={noop}
          onApprovePlan={noop}
          onRejectPlan={noop}
        />
      ),
    },
  },
}

export default fixture
