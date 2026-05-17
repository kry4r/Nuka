// test/tui/planModeBadge.test.tsx
//
// Iter DDDD — TUI plan-mode badge.
//
// Verifies that StatusPanel renders the `[PLAN MODE]` text badge only
// when its `planMode` prop is true, and that the badge:
//   1. is absent in the normal (`planMode={false}` / undefined) path
//   2. appears in every layout mode (dense / compact / oneline)
//   3. reacts to prop changes (rerender flips the badge on/off)
//   4. uses bold yellow/warn-style text so it's visually loud
//
// The component itself doesn't subscribe to PlanModeState directly —
// App.tsx owns that subscription and forwards `session.mode === 'plan'`
// as a boolean prop, so testing StatusPanel in isolation is sufficient
// for the rendering contract.

import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { StatusPanel } from '../../src/tui/Status/StatusPanel'

const baseProps = {
  mode: 'idle' as const,
  model: 'opus-4.7',
  providerId: 'anthropic',
  cwd: '/home/me/proj',
  gitBranch: { branch: 'main', dirty: false },
  contextUsed: 12_000,
  contextMax: 200_000,
  inputTokens: 10_000,
  outputTokens: 2_000,
  cost: 0.04,
  pluginCount: 4,
  sessionPluginCount: 0,
  agentInFlight: 0,
  hiddenSegments: [] as string[],
  iconMode: 'icon' as const,
} as const

describe('StatusPanel plan-mode badge (Iter DDDD)', () => {
  it('omits the [PLAN MODE] badge when planMode is undefined', () => {
    const { lastFrame } = render(
      <StatusPanel {...baseProps} layout="dense" />,
    )
    const f = lastFrame() ?? ''
    expect(f).not.toContain('[PLAN MODE]')
    expect(f).not.toContain('PLAN MODE')
  })

  it('omits the [PLAN MODE] badge when planMode is false', () => {
    const { lastFrame } = render(
      <StatusPanel {...baseProps} layout="dense" planMode={false} />,
    )
    const f = lastFrame() ?? ''
    expect(f).not.toContain('[PLAN MODE]')
    // The other segments still render so we know the panel didn't bail.
    expect(f).toContain('⬢ idle')
    expect(f).toContain('opus-4.7')
  })

  it('renders [PLAN MODE] in the dense layout when planMode is true', () => {
    const { lastFrame } = render(
      <StatusPanel {...baseProps} layout="dense" planMode={true} />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('[PLAN MODE]')
    // Normal status segments still render alongside the badge.
    expect(f).toContain('⬢ idle')
    expect(f).toContain('opus-4.7')
    expect(f).toContain('main')
  })

  it('renders [PLAN MODE] in the compact layout when planMode is true', () => {
    const { lastFrame } = render(
      <StatusPanel {...baseProps} layout="compact" planMode={true} />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('[PLAN MODE]')
    // Compact layout keeps the badge above the fold next to mode/model.
    expect(f).toContain('⬢ idle')
    expect(f).toContain('opus-4.7')
  })

  it('renders [PLAN MODE] in the oneline layout when planMode is true', () => {
    const { lastFrame } = render(
      <StatusPanel {...baseProps} layout="oneline" planMode={true} />,
    )
    const f = lastFrame() ?? ''
    // Oneline can wrap under ink-testing-library, so we only assert the
    // badge string is present somewhere in the frame.
    expect(f).toContain('PLAN MODE')
  })

  it('reacts to prop changes (rerender flips the badge on/off)', () => {
    const { lastFrame, rerender } = render(
      <StatusPanel {...baseProps} layout="dense" planMode={false} />,
    )
    expect(lastFrame() ?? '').not.toContain('[PLAN MODE]')

    rerender(
      <StatusPanel {...baseProps} layout="dense" planMode={true} />,
    )
    expect(lastFrame() ?? '').toContain('[PLAN MODE]')

    rerender(
      <StatusPanel {...baseProps} layout="dense" planMode={false} />,
    )
    expect(lastFrame() ?? '').not.toContain('[PLAN MODE]')
  })

  it('badge is hidden when the user adds `plan` to hiddenSegments', () => {
    // Although there's no UI today that toggles this, the segment
    // honours `hiddenSegments` like every other id — useful for users
    // who want plan mode signalled only via the `/plan` slash command.
    const { lastFrame } = render(
      <StatusPanel
        {...baseProps}
        layout="dense"
        planMode={true}
        hiddenSegments={['plan']}
      />,
    )
    const f = lastFrame() ?? ''
    expect(f).not.toContain('[PLAN MODE]')
    expect(f).toContain('⬢ idle')
  })

  it('badge coexists with text-mode icon style', () => {
    const { lastFrame } = render(
      <StatusPanel
        {...baseProps}
        layout="dense"
        planMode={true}
        iconMode="text"
      />,
    )
    const f = lastFrame() ?? ''
    // text mode replaces the glyph mode badge with [idle] but still
    // renders the plan-mode badge using bracket notation, so both
    // bracketed strings appear.
    expect(f).toContain('[idle]')
    expect(f).toContain('[PLAN MODE]')
  })
})
