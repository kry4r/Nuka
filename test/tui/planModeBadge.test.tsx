import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { StatusPanel } from '../../src/tui/Status/StatusPanel'

const baseProps = {
  mode: 'idle' as const,
  model: 'opus-4.7',
  providerId: 'anthropic',
  providerName: 'Anthropic',
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

describe('StatusPanel plan-mode badge', () => {
  it('omits the plan badge when planMode is undefined or false', () => {
    const a = render(<StatusPanel {...baseProps} layout="dense" />)
    expect(a.lastFrame() ?? '').not.toContain('[PLAN MODE]')
    a.unmount()

    const b = render(<StatusPanel {...baseProps} layout="dense" planMode={false} />)
    expect(b.lastFrame() ?? '').not.toContain('[PLAN MODE]')
    expect(b.lastFrame() ?? '').toContain('Anthropic/opus-4.7')
    b.unmount()
  })

  it('renders [PLAN MODE] in every layout preference', () => {
    for (const layout of ['dense', 'compact', 'oneline'] as const) {
      const { lastFrame, unmount } = render(
        <StatusPanel {...baseProps} layout={layout} planMode />,
      )
      const f = lastFrame() ?? ''
      expect(f).toContain('[PLAN MODE]')
      expect(f).toContain('Anthropic/opus-4')
      unmount()
    }
  })

  it('reacts to prop changes', () => {
    const { lastFrame, rerender } = render(
      <StatusPanel {...baseProps} layout="dense" planMode={false} />,
    )
    expect(lastFrame() ?? '').not.toContain('[PLAN MODE]')

    rerender(<StatusPanel {...baseProps} layout="dense" planMode />)
    expect(lastFrame() ?? '').toContain('[PLAN MODE]')

    rerender(<StatusPanel {...baseProps} layout="dense" planMode={false} />)
    expect(lastFrame() ?? '').not.toContain('[PLAN MODE]')
  })

  it('badge is hidden when the user adds `plan` to hiddenSegments', () => {
    const { lastFrame } = render(
      <StatusPanel
        {...baseProps}
        layout="dense"
        planMode
        hiddenSegments={['plan']}
      />,
    )
    const f = lastFrame() ?? ''
    expect(f).not.toContain('[PLAN MODE]')
    expect(f).toContain('Anthropic/opus-4.7')
  })

  it('coexists with text-mode style', () => {
    const { lastFrame } = render(
      <StatusPanel
        {...baseProps}
        mode="running"
        layout="dense"
        planMode
        iconMode="text"
      />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('[running]')
    expect(f).toContain('[PLAN MODE]')
  })
})
