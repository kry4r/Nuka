// test/ui-auto/fixtures/iter-14-monitor-tokens-cjk-agent.fixtures.tsx
//
// Iter-14 sweep: Monitor token rollup agent-name column at narrow viewports.
//
// Coverage rationale:
//   TokensView aligns agent names with String.padEnd(20). A CJK-heavy agent
//   name must be bounded by terminal display width and show an ellipsis
//   instead of overflowing the token row.

import React from 'react'
import { TokensView } from '../../../src/tui/Monitor/TokensView'
import type { FixtureDef } from '../../../src/core/testing/explorer/types'

const fixture: FixtureDef = {
  component: 'MonitorTokensCjkAgent',
  viewports: [
    { cols: 60, rows: 30 },
    { cols: 70, rows: 30 },
  ],
  cases: {
    'cjk-agent-name-truncates-by-display-width': {
      render: () => (
        <TokensView
          usage={[
            {
              agentName: '一'.repeat(28),
              inputTokens: 12345,
              outputTokens: 67890,
            },
          ]}
        />
      ),
      mustContain: ['…'],
    },
  },
}

export default fixture
