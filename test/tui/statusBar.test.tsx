// test/tui/statusBar.test.tsx
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { StatusBar } from '../../src/tui/StatusBar/StatusBar'

describe('StatusBar', () => {
  it('renders model, cwd, git, context, cost segments', () => {
    const { lastFrame } = render(
      <StatusBar
        model="sonnet-4-6"
        cwd="~/Nuka"
        gitBranch={{ branch: 'main', dirty: true }}
        contextUsed={14000}
        contextMax={200000}
        cost={0.28}
        mcpCount={0}
        mcpHealth="none"
        autoMode="off"
        queueLength={0}
        mode="idle"
      />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('sonnet-4-6')
    expect(f).toContain('~/Nuka')
    expect(f).toContain('main')
    expect(f).toContain('14k/200k')
    expect(f).toContain('$0.28')
  })

  it('shows esc cancel hint while running', () => {
    const { lastFrame } = render(
      <StatusBar
        model="m" cwd="~" gitBranch={null} contextUsed={0} contextMax={200000}
        cost={0} mcpCount={0} mcpHealth="none" autoMode="off" queueLength={0} mode="running"
      />,
    )
    expect(lastFrame()).toContain('esc cancel')
  })

  it('shows dot and count when mcpHealth is degraded', () => {
    const { lastFrame } = render(
      <StatusBar
        model="m" cwd="~" gitBranch={null} contextUsed={0} contextMax={200000}
        cost={0} mcpCount={2} mcpHealth="degraded" autoMode="off" queueLength={0} mode="idle"
      />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('●')
    expect(f).toContain('2 mcp')
  })
})
