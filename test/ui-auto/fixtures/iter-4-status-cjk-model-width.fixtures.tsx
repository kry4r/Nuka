// test/ui-auto/fixtures/iter-4-status-cjk-model-width.fixtures.tsx
//
// Iter-4 sweep: StatusPanel dense model row at narrow widths.
//
// Coverage rationale:
//   StatusPanel left-truncates the model name in dense layout. The current
//   helper uses code-unit length, which undercounts CJK display width and can
//   let a visually-too-wide model escape without an ellipsis.

import React from 'react'
import { StatusPanel } from '../../../src/tui/Status/StatusPanel'
import type { FixtureDef } from '../../../src/core/testing/explorer/types'

const fixture: FixtureDef = {
  component: 'StatusCjkModelWidth',
  viewports: [
    { cols: 60, rows: 30 },
    { cols: 70, rows: 30 },
    { cols: 79, rows: 24 },
  ],
  cases: {
    'cjk-model-name-needs-display-width-truncation': {
      render: () => (
        <StatusPanel
          mode="idle"
          model="混合智能模型一二三四五"
          providerId="anthropic"
          cwd="/home/me"
          gitBranch={{ branch: 'main', dirty: false }}
          contextUsed={12000}
          contextMax={200000}
          inputTokens={10000}
          outputTokens={2000}
          cost={0.04}
          pluginCount={4}
          sessionPluginCount={0}
          agentInFlight={0}
          hiddenSegments={[]}
          layout="dense"
          iconMode="icon"
        />
      ),
      mustContain: ['…'],
    },
  },
}

export default fixture
