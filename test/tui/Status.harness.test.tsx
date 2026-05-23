import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { StatusPanel } from '../../src/tui/Status/StatusPanel'
import { renderWithViewport } from '../../src/core/testing/explorer/L0/render'

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

describe('StatusPanel', () => {
  it('renders a claude-status style single-line summary', () => {
    const { lastFrame } = render(
      <StatusPanel {...baseProps} layout="dense" />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('/home/me/proj')
    expect(f).toContain('main')
    expect(f).toContain('Anthropic/opus-4.7')
    expect(f).toContain('∴ context:')
    expect(f).toContain('12k/200k')
    expect(f).toContain('$0.0400')
    expect(f).toContain('4 plugins')
    expect(f).not.toContain('│')
    expect(f).not.toContain('⬢ idle')
  })

  it('uses the configured provider name instead of provider id', () => {
    const { lastFrame } = render(
      <StatusPanel {...baseProps} providerId="custom-2" providerName="Nuka" layout="dense" />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('Nuka/opus-4.7')
    expect(f).not.toContain('custom-2/opus-4.7')
  })

  it('preserves the configured provider name in narrow compact layout', async () => {
    const handle = renderWithViewport(
      <StatusPanel
        {...baseProps}
        mode="running"
        providerId="custom-2"
        providerName="Xiaomi Mimo"
        model="mimo-v2-pro"
        cost={0}
        pluginCount={0}
        agentInFlight={1}
        contextUsed={87_000}
        contextMax={100_000}
        layout="compact"
        iconMode="text"
      />,
      { cols: 70, rows: 6 },
    )
    try {
      await new Promise<void>(resolve => setImmediate(resolve))
      const f = handle.lastFrame() ?? ''
      expect(f).toContain('Xiaomi Mimo')
      expect(f).toContain('mimo-v2-pro')
      expect(f).not.toMatch(/∴context|context[█░]/)
      expect(f).not.toContain('custom-2')
    } finally {
      handle.unmount()
    }
  })

  it('omits zero-value noise', () => {
    const { lastFrame } = render(
      <StatusPanel
        {...baseProps}
        cost={0}
        pluginCount={0}
        sessionPluginCount={0}
        agentInFlight={0}
        layout="dense"
      />,
    )
    const f = lastFrame() ?? ''
    expect(f).not.toContain('$0.0000')
    expect(f).not.toContain('plugins')
    expect(f).not.toContain('agents')
  })

  it('hidden filter drops the cost segment (old cost-time id also works)', () => {
    const { lastFrame } = render(
      <StatusPanel {...baseProps} layout="dense" hiddenSegments={['cost']} />,
    )
    const f = lastFrame() ?? ''
    expect(f).not.toMatch(/\$0\.04/)
    expect(f).toContain('Anthropic/opus-4.7')
    expect(f).toContain('plugins')
  })

  it('backward-compat: hidden cost-time also hides cost segment', () => {
    const { lastFrame } = render(
      <StatusPanel {...baseProps} layout="dense" hiddenSegments={['cost-time']} />,
    )
    const f = lastFrame() ?? ''
    expect(f).not.toMatch(/\$0\.04/)
    expect(f).toContain('Anthropic/opus-4.7')
  })

  it('returns null when every segment is hidden and no statusLine row', () => {
    const { lastFrame } = render(
      <StatusPanel
        {...baseProps}
        layout="dense"
        hiddenSegments={['mode', 'model', 'cwd', 'context', 'cost', 'counts']}
      />,
    )
    const f = lastFrame() ?? ''
    expect(f.trim()).toBe('')
  })

  it('shows running mode but keeps idle quiet', () => {
    const idle = render(<StatusPanel {...baseProps} layout="dense" />)
    expect(idle.lastFrame() ?? '').not.toContain('idle')
    idle.unmount()

    const running = render(<StatusPanel {...baseProps} mode="running" layout="dense" />)
    expect(running.lastFrame() ?? '').toContain('running')
    running.unmount()
  })

  it('text mode uses plain labels for non-idle modes', () => {
    const { lastFrame } = render(
      <StatusPanel {...baseProps} mode="running" layout="dense" iconMode="text" />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('[running]')
    expect(f).not.toContain('⬢')
    expect(f).toContain('context:')
  })

  it('icon mode uses glyphs for non-idle modes and the context bar', () => {
    const { lastFrame } = render(
      <StatusPanel {...baseProps} mode="running" layout="dense" iconMode="icon" />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('⬢ running')
    expect(f).toMatch(/█|░/)
  })

  it('surfaces compact pressure before the context window is exhausted', () => {
    const warn = render(
      <StatusPanel
        {...baseProps}
        contextUsed={82_000}
        contextMax={100_000}
        layout="dense"
      />,
    )
    expect(warn.lastFrame() ?? '').toContain('compact soon')
    warn.unmount()

    const error = render(
      <StatusPanel
        {...baseProps}
        contextUsed={92_000}
        contextMax={100_000}
        layout="dense"
      />,
    )
    expect(error.lastFrame() ?? '').toContain('compact now')
  })
})
