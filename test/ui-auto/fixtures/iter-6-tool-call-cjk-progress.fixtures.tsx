// test/ui-auto/fixtures/iter-6-tool-call-cjk-progress.fixtures.tsx
//
// Iter-6 sweep: ToolCall progress line width at narrow explorer viewports.
//
// Coverage rationale:
//   ToolCall bounds progress output inside a bordered box. Long unbreakable
//   CJK progress lines must be display-width truncated with a visible
//   bound at narrow explorer widths, not wrapped past the viewport by
//   code-unit slicing.

import React from 'react'
import { ToolCall } from '../../../src/tui/Messages/ToolCall'
import type { FixtureDef } from '../../../src/core/testing/explorer/types'

const fixture: FixtureDef = {
  component: 'ToolCallCjkProgress',
  viewports: [
    { cols: 60, rows: 30 },
    { cols: 70, rows: 30 },
  ],
  cases: {
    'cjk-progress-line-truncates-by-display-width': {
      render: () => (
        <ToolCall
          name="Bash"
          argSummary="long progress"
          status="running"
          progressLines={['一'.repeat(80)]}
        />
      ),
    },
  },
}

export default fixture
