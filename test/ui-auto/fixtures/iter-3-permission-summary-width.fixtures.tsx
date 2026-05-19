// test/ui-auto/fixtures/iter-3-permission-summary-width.fixtures.tsx
//
// Iter-3 sweep: PermissionDialog summary row at narrow widths.
//
// Coverage rationale:
//   PermissionDialog renders JSON.stringify(call.input) as the summary line.
//   A long CJK-heavy command should be width-truncated with a visible
//   ellipsis at narrow widths, not clipped by code-unit length.

import React from 'react'
import { PermissionDialog } from '../../../src/tui/dialogs/PermissionDialog'
import type { FixtureDef } from '../../../src/core/testing/explorer/types'

const summaryCommand = '一'.repeat(40)

const fixture: FixtureDef = {
  component: 'PermissionSummaryWidth',
  viewports: [
    { cols: 60, rows: 30 },
    { cols: 70, rows: 30 },
    { cols: 79, rows: 24 },
  ],
  cases: {
    'cjk-summary-truncates-by-display-width': {
      render: () => (
        <PermissionDialog
          call={{
            toolName: 'Bash',
            hint: 'exec',
            input: {
              command: summaryCommand,
            },
          }}
          onDecide={() => {}}
        />
      ),
      mustContain: ['…'],
    },
  },
}

export default fixture
