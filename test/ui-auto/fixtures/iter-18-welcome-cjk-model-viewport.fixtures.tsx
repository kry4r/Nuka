// test/ui-auto/fixtures/iter-18-welcome-cjk-model-viewport.fixtures.tsx
//
// Iter-18 sweep: Welcome CJK model row at narrow explorer viewports.
//
// Coverage rationale:
//   Welcome chooses compact vs two-column layout from terminal columns. Under
//   the explorer renderer, that must come from Ink's injected stdout viewport,
//   not the host process stdout. A CJK model row should stay within 60/70
//   column captures instead of rendering a two-column row one cell too wide.

import React from 'react'
import { Welcome } from '../../../src/tui/Welcome/Welcome'
import type { FixtureDef } from '../../../src/core/testing/explorer/types'

const fixture: FixtureDef = {
  component: 'WelcomeCjkModelViewport',
  viewports: [
    { cols: 60, rows: 30 },
    { cols: 70, rows: 30 },
  ],
  cases: {
    'cjk-model-row-uses-explorer-viewport-width': {
      render: () => (
        <Welcome
          cwd="/home/user/work"
          gitBranch={{ branch: 'main', dirty: false }}
          model="混合智能模型-Pro"
          version="2.0.0"
          updates={[]}
          recent={[]}
        />
      ),
      mustContain: ['Pro'],
    },
  },
}

export default fixture
