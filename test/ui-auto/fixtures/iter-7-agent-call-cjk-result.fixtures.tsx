// test/ui-auto/fixtures/iter-7-agent-call-cjk-result.fixtures.tsx
//
// Iter-7 sweep: AgentCall expanded result box at narrow explorer viewports.
//
// Coverage rationale:
//   AgentCall bounds expanded sub-agent results inside a bordered box. Long
//   unbreakable CJK result lines must be display-width truncated inside the
//   box, not wrapped past the viewport by code-unit slicing.

import React from 'react'
import { AgentCall } from '../../../src/tui/Messages/AgentCall'
import type { FixtureDef } from '../../../src/core/testing/explorer/types'

const fixture: FixtureDef = {
  component: 'AgentCallCjkResult',
  viewports: [
    { cols: 60, rows: 30 },
    { cols: 70, rows: 30 },
  ],
  cases: {
    'cjk-result-line-stays-inside-box': {
      render: () => (
        <AgentCall
          agent="core:reviewer"
          task="review"
          status="ok"
          result={'一'.repeat(80)}
          expanded={true}
        />
      ),
    },
  },
}

export default fixture
