// test/tui/Status/Hud.test.tsx
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { Hud } from '../../../src/tui/Status/Hud'
import { ThemeProvider } from '../../../src/core/theme/context'
import { findTheme } from '../../../src/core/theme/themes'

describe('Status HUD', () => {
  it('renders all six fields with a known mock state', () => {
    const tracker = { current: () => ({ usd: 0.0721 }) }
    const { lastFrame } = render(
      <Hud
        providerId="anthropic"
        model="claude-opus-4-7"
        sessionId="s1"
        contextUsed={24800}
        contextMax={200000}
        inputTokens={1200}
        outputTokens={400}
        pluginCount={3}
        agentInFlight={2}
        gitBranch="main"
        costTracker={tracker}
      />,
    )
    const f = lastFrame() ?? ''
    // Ink may wrap segments across lines under the test renderer's narrow width.
    // Strip whitespace+newlines for substring assertions.
    const flat = f.replace(/\s+/g, ' ')
    expect(flat).toContain('anthropic/claude-opus-4-7')
    expect(flat).toMatch(/ctx /)
    expect(flat).toContain('24.8k/200k')
    expect(flat).toContain('▲in 1.2k')
    expect(flat).toContain('▼out')
    expect(flat).toContain('$0.0721')
    expect(flat).toContain('plugins 3')
    expect(flat).toContain('agents 2 in-flight')
    expect(flat).toContain('git:main')
  })

  it('falls back to $-- when no cost tracker is provided', () => {
    const { lastFrame } = render(
      <Hud
        providerId="openai"
        model="gpt-4o"
        sessionId="s1"
        contextUsed={0}
        contextMax={200000}
        inputTokens={0}
        outputTokens={0}
        pluginCount={0}
        agentInFlight={0}
        gitBranch={null}
      />,
    )
    const flat = (lastFrame() ?? '').replace(/\s+/g, ' ')
    expect(flat).toContain('$--')
    expect(flat).toContain('git:no-git')
  })

  it('survives a cost tracker that throws', () => {
    const tracker = { current: () => { throw new Error('boom') } }
    const { lastFrame } = render(
      <Hud
        providerId="x"
        model="m"
        sessionId="s1"
        contextUsed={1000}
        contextMax={200000}
        inputTokens={0}
        outputTokens={0}
        pluginCount={0}
        agentInFlight={0}
        gitBranch="dev"
        costTracker={tracker}
      />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('$--')
    expect(f).toContain('git:dev')
  })

  it('colors ctx red when over 95%', () => {
    const { lastFrame } = render(
      <Hud
        providerId="p"
        model="m"
        sessionId="s1"
        contextUsed={199000}
        contextMax={200000}
        inputTokens={0}
        outputTokens={0}
        pluginCount={0}
        agentInFlight={0}
        gitBranch={null}
      />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('99.5%')
  })

  it('renders correctly when wrapped in a ThemeProvider', () => {
    const theme = findTheme('solarized-dark')!
    const { lastFrame } = render(
      <ThemeProvider theme={theme}>
        <Hud
          providerId="anthropic"
          model="claude-opus-4-7"
          sessionId="s2"
          contextUsed={10000}
          contextMax={200000}
          inputTokens={500}
          outputTokens={200}
          pluginCount={1}
          agentInFlight={0}
          gitBranch="main"
        />
      </ThemeProvider>,
    )
    const flat = (lastFrame() ?? '').replace(/\s+/g, ' ')
    expect(flat).toContain('anthropic/claude-opus-4-7')
    expect(flat).toContain('git:main')
    expect(flat).toContain('plugins 1')
  })
})
