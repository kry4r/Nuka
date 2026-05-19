// test/ui-auto/fixtures/iter-3-permission-summary-width.fixtures.tsx
//
// Iter-3 sweep: PermissionDialog summary row at narrow widths.
//
// Coverage rationale:
//   PermissionDialog uses JSON.stringify(call.input) as the summary line and
//   currently truncates it by .length, which undercounts CJK display width.
//   A long CJK-heavy command should therefore overflow the viewport at narrow
//   widths until the summary uses width-aware truncation.

import React from 'react'
import { PermissionDialog } from '../../../src/tui/dialogs/PermissionDialog'
import type { FixtureDef } from '../../../src/core/testing/explorer/types'

const summaryCommand = '一'.repeat(40)
const summaryText = JSON.stringify({ command: summaryCommand })

const fixture: FixtureDef = {
  component: 'PermissionSummaryWidth',
  viewports: [
    { cols: 60, rows: 30 },
    { cols: 70, rows: 30 },
    { cols: 79, rows: 24 },
  ],
  cases: {
    'cjk-summary-overflows-when-width-uses-length': {
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
      mustContain: [summaryText, '…'],
    },
  },
}

export default fixture
