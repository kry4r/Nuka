// test/ui-auto/fixtures/iter-11-submenu-list-cjk-value.fixtures.tsx
//
// Iter-11 sweep: SubmenuList value summary at narrow viewports.
//
// Coverage rationale:
//   SubmenuList caps the right-aligned value summary with code-unit length
//   and slice(). A CJK value summary must be display-width truncated inside
//   the fixed value column and show an ellipsis instead of overflowing.

import React from 'react'
import { SubmenuList } from '../../../src/tui/Submenu/SubmenuList'
import type { FixtureDef } from '../../../src/core/testing/explorer/types'

const fixture: FixtureDef = {
  component: 'SubmenuListCjkValue',
  viewports: [
    { cols: 60, rows: 30 },
    { cols: 70, rows: 30 },
  ],
  cases: {
    'cjk-value-summary-truncates-by-display-width': {
      render: () => (
        <SubmenuList
          items={[
            {
              id: 'model',
              label: 'Model',
              description: 'selected model',
              value: '一'.repeat(80),
            },
          ]}
          onSelect={() => {}}
          onCancel={() => {}}
          omitFooter
        />
      ),
      mustContain: ['…'],
    },
  },
}

export default fixture
