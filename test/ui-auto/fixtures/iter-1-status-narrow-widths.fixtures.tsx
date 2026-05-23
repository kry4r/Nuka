// test/ui-auto/fixtures/iter-1-status-narrow-widths.fixtures.tsx
//
// Iter-1 sweep: StatusPanel across viewport widths and mode variants.
//
// Coverage rationale:
//   StatusPanel auto-degrades layout: dense→compact at <80, compact→oneline.
//   At narrow widths the progress bar and mode badge must not overflow the
//   viewport. Each case exercises a distinct segment combination.
//
// ThemeContext defaults to defaultDark when no provider wraps — no wrapper needed.
// StatusPanel reads useTerminalSize() but the explorer's viewport drives it.

import React from 'react'
import { StatusPanel } from '../../../src/tui/Status/StatusPanel'
import type { FixtureDef } from '../../../src/core/testing/explorer/types'

const BASE = {
  model: 'claude-opus-4',
  providerId: 'anthropic',
  cwd: '/home/user/project',
  gitBranch: null,
  contextUsed: 10000,
  contextMax: 200000,
  cost: 0.0042,
  pluginCount: 2,
  sessionPluginCount: 0,
  agentInFlight: 0,
  hiddenSegments: [],
  layout: 'dense' as const,
}

const fixture: FixtureDef = {
  component: 'StatusNarrowWidths',
  cases: {
    'idle-dense-clean-branch': {
      render: () => (
        <StatusPanel
          {...BASE}
          mode="idle"
          gitBranch={{ branch: 'main', dirty: false }}
        />
      ),
      mustContain: ['main'],
    },
    'running-plan-mode-badge': {
      // Iter DDDD — planMode=true injects [PLAN MODE] badge after mode.
      render: () => (
        <StatusPanel
          {...BASE}
          mode="running"
          planMode={true}
          gitBranch={{ branch: 'feat/plan', dirty: false }}
        />
      ),
      mustContain: ['PLAN MODE'],
    },
    'high-context-usage-error-color': {
      // >95% usage flips ctxColor to error. Probe structural stability.
      render: () => (
        <StatusPanel
          {...BASE}
          mode="idle"
          contextUsed={192000}
          contextMax={200000}
          inputTokens={10000}
          outputTokens={2000}
        />
      ),
    },
    'long-model-name-truncated': {
      // P0 #11: dense layout pre-truncates model via truncateLeftEllipsis.
      render: () => (
        <StatusPanel
          {...BASE}
          mode="idle"
          model="anthropic.claude-3-5-sonnet-20241022-v2:0"
          effort="high"
        />
      ),
    },
    'dirty-branch-with-long-cwd': {
      render: () => (
        <StatusPanel
          {...BASE}
          mode="awaiting-user"
          cwd="/home/user/deep/nested/repository/path/to/subproject"
          gitBranch={{ branch: 'fix/very-long-branch-name-that-wraps', dirty: true }}
        />
      ),
      mustContain: ['awaiting'],
    },
  },
}

export default fixture
