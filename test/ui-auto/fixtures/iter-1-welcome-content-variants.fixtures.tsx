// test/ui-auto/fixtures/iter-1-welcome-content-variants.fixtures.tsx
//
// Iter-1 sweep: Welcome component content variations.
//
// Coverage rationale:
//   Bug B fixture is narrow — tests layout-mode edge; these cases probe
//   the content layer: CJK model names, long cwd truncation, dirty branch
//   indicators, 0/5 recent entries, updates list presence.
//
// Welcome reads useTerminalSize() but also accepts columnsOverride/rowsOverride.
// We do NOT set columnsOverride so the explorer's viewport matrix drives the
// layout-mode branching (compact at <79, normal at 79-109, wide at ≥110).
//
// mustContain strings are chosen so noLossyTruncation fires if content is
// silently dropped by the renderer at narrow widths.

import React from 'react'
import { Welcome } from '../../../src/tui/Welcome/Welcome'
import type { FixtureDef } from '../../../src/core/testing/explorer/types'

const RECENT_5 = [
  { id: 'r1', preview: 'Fix the authentication bug', updatedAt: Date.now() - 3600_000 },
  { id: 'r2', preview: 'Refactor the database layer', updatedAt: Date.now() - 7200_000 },
  { id: 'r3', preview: 'Add unit tests for parser', updatedAt: Date.now() - 86400_000 },
  { id: 'r4', preview: 'Update dependencies to latest', updatedAt: Date.now() - 172800_000 },
  { id: 'r5', preview: 'Implement retry logic', updatedAt: Date.now() - 259200_000 },
]

const UPDATES_2 = [
  { version: 'v1.2.0', title: 'New features', bullets: ['Improved performance', 'Bug fixes'] },
  { version: 'v1.1.5', title: 'Hotfix', bullets: ['Critical security patch'] },
]

const fixture: FixtureDef = {
  component: 'WelcomeContentVariants',
  cases: {
    'clean-branch-no-recent-no-updates': {
      render: () => (
        <Welcome
          cwd="/home/user/projects/my-project"
          gitBranch={{ branch: 'main', dirty: false }}
          model="claude-opus-4"
          version="1.0.0"
          updates={[]}
          recent={[]}
        />
      ),
      mustContain: ['main', 'claude-opus-4'],
    },
    'dirty-branch-5-recent-2-updates': {
      render: () => (
        <Welcome
          cwd="/home/user/projects/my-project"
          gitBranch={{ branch: 'feature/new-thing', dirty: true }}
          model="claude-sonnet-4-5"
          version="1.0.0"
          updates={UPDATES_2}
          recent={RECENT_5}
        />
      ),
      mustContain: ['feature/new-thing'],
    },
    'cjk-model-name': {
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
      // CJK chars are width-2; noLossyTruncation fires if they get silently
      // dropped at narrow viewports. The short ASCII tail must survive.
      mustContain: ['Pro'],
    },
    'long-cwd-path': {
      render: () => (
        <Welcome
          cwd="/home/user/deep/nested/projects/my-very-long-project-name/subdir"
          gitBranch={null}
          model="claude-haiku-3"
          version="1.0.0"
          updates={[]}
          recent={[]}
        />
      ),
      mustContain: ['claude-haiku-3'],
    },
    'username-too-long-falls-back': {
      // formatWelcomeMessage truncates usernames longer than 20 chars; the
      // fallback "Welcome back!" must always appear.
      render: () => (
        <Welcome
          cwd="/home/user/project"
          gitBranch={{ branch: 'dev', dirty: false }}
          model="gpt-4o"
          version="1.0.0"
          updates={[]}
          recent={[]}
          username="this-username-is-way-too-long-to-display"
        />
      ),
      mustContain: ['Welcome back!'],
    },
  },
}

export default fixture
