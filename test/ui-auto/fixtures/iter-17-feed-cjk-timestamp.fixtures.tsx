// test/ui-auto/fixtures/iter-17-feed-cjk-timestamp.fixtures.tsx
//
// Iter-17 sweep: Welcome Feed timestamp gutter with CJK timestamps.
//
// Coverage rationale:
//   Feed calculates timestamp gutter width in terminal display cells, but
//   render-time padding uses String.padEnd(). A CJK timestamp must be padded
//   by display width so the timestamp gutter plus truncated text stays inside
//   the declared feed width at narrow viewports.

import React from 'react'
import { Feed } from '../../../src/tui/Welcome/Feed'
import type { FixtureDef } from '../../../src/core/testing/explorer/types'

const fixture: FixtureDef = {
  component: 'FeedCjkTimestamp',
  viewports: [
    { cols: 60, rows: 20 },
    { cols: 70, rows: 20 },
  ],
  cases: {
    'cjk-timestamp-gutter-pads-by-display-width': {
      render: () => (
        <Feed
          actualWidth={60}
          config={{
            title: 'Recent',
            lines: [
              {
                timestamp: '更新'.repeat(6),
                text: '一'.repeat(40),
              },
            ],
          }}
        />
      ),
      mustContain: ['更新更新更新更新更新更新  一', '…'],
    },
  },
}

export default fixture
