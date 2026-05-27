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
  it('renders claude-status style environment row plus a quiet provider detail row', async () => {
    const handle = renderWithViewport(
      <StatusPanel {...baseProps} layout="dense" />,
      { cols: 120, rows: 4 },
    )
    try {
      await new Promise<void>(resolve => setImmediate(resolve))
      const f = handle.lastFrame() ?? ''
      const lines = f.split('\n').filter(line => line.trim().length > 0)
      expect(lines).toHaveLength(2)
      expect(lines[0]).toContain('/home/me/proj')
      expect(lines[0]).toContain('main')
      expect(lines[0]).toContain('∴ context:')
      expect(lines[0]).not.toContain('Anthropic')
      expect(lines[1]).toContain('Anthropic · opus-4.7')
      expect(lines[1]).toContain('$0.0400')
      expect(lines[1]).toContain('4 plugins')
      expect(f).not.toContain('│')
      expect(f).not.toContain('⬢ idle')
    } finally {
      handle.unmount()
    }
  })

  it('uses the configured provider name instead of provider id', () => {
    const { lastFrame } = render(
      <StatusPanel {...baseProps} providerId="custom-2" providerName="Nuka" layout="dense" />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('Nuka · opus-4.7')
    expect(f).not.toContain('custom-2')
  })

  it('shows the active goal in the location row', () => {
    const { lastFrame } = render(
      <StatusPanel
        {...baseProps}
        goal={{ objective: 'finish provider polish', status: 'active' }}
        layout="dense"
      />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('goal: finish provider polish')
    expect(f).not.toContain('goal: active')
  })

  it('truncates long goal text by display width in narrow layouts', async () => {
    const handle = renderWithViewport(
      <StatusPanel
        {...baseProps}
        cwd="/data/xtzhang/Nuka"
        gitBranch={{ branch: 'main', dirty: true }}
        cost={0}
        pluginCount={0}
        contextUsed={20_000}
        contextMax={200_000}
        goal={{
          objective: '完成当前bug修复之后继续复刻Nuka-Code subagent系统',
          status: 'blocked',
        }}
        layout="compact"
        iconMode="text"
      />,
      { cols: 70, rows: 8 },
    )
    try {
      await new Promise<void>(resolve => setImmediate(resolve))
      const f = handle.lastFrame() ?? ''
      expect(f).toContain('blocked:')
      expect(f).toContain('…')
      expect(f).not.toContain('完成当前bug修复之后继续复刻Nuka-Code subagent系统')
    } finally {
      handle.unmount()
    }
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
      expect(f).toContain('∴ context:')
      expect(f).not.toMatch(/∴context|context[█░]/)
      expect(f).not.toContain('custom-2')
    } finally {
      handle.unmount()
    }
  })

  it('uses two readable narrow rows instead of crowding provider, cwd, and context together', async () => {
    const handle = renderWithViewport(
      <StatusPanel
        {...baseProps}
        mode="running"
        providerId="custom-2"
        providerName="Xiaomi Mimo"
        model="mimo-v2-pro"
        cwd="/data/xtzhang/Nuka"
        gitBranch={{ branch: 'main', dirty: true }}
        cost={0}
        pluginCount={0}
        agentInFlight={1}
        contextUsed={174_000}
        contextMax={200_000}
        layout="compact"
        iconMode="text"
      />,
      { cols: 70, rows: 6 },
    )
    try {
      await new Promise<void>(resolve => setImmediate(resolve))
      const lines = (handle.lastFrame() ?? '').split('\n').filter(line => line.trim().length > 0)
      expect(lines).toHaveLength(2)
      expect(lines[0]).toContain('87%')
      expect(lines[0]).toContain('/data/xtzhang/Nuka')
      expect(lines[0]).toContain('main●')
      expect(lines[0]).not.toContain('Xiaomi Mimo')
      expect(lines[1]).toContain('[running]')
      expect(lines[1]).toContain('Xiaomi Mimo · mimo-v2-pro')
      expect(lines[1]).toContain('1 agent')
      expect(lines[1]).not.toContain('custom-2')
    } finally {
      handle.unmount()
    }
  })

  it('splits compact statusline before provider model text is clipped', async () => {
    const handle = renderWithViewport(
      <StatusPanel
        {...baseProps}
        mode="running"
        providerId="xiaomi-mimo"
        providerName="Xiaomi Mimo"
        model="mimo-v2-pro"
        cwd="/data/xtzhang/Nuka"
        gitBranch={{ branch: 'main', dirty: true }}
        cost={0}
        pluginCount={0}
        agentInFlight={1}
        contextUsed={174_000}
        contextMax={200_000}
        layout="compact"
        iconMode="text"
      />,
      { cols: 100, rows: 8 },
    )
    try {
      await new Promise<void>(resolve => setImmediate(resolve))
      const f = handle.lastFrame() ?? ''
      expect(f).toContain('Xiaomi Mimo · mimo-v2-pro')
      expect(f).not.toContain('Xiaomi Mimo/  1 agents')
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
    expect(f).toContain('Anthropic · opus-4.7')
    expect(f).toContain('plugins')
  })

  it('backward-compat: hidden cost-time also hides cost segment', () => {
    const { lastFrame } = render(
      <StatusPanel {...baseProps} layout="dense" hiddenSegments={['cost-time']} />,
    )
    const f = lastFrame() ?? ''
    expect(f).not.toMatch(/\$0\.04/)
    expect(f).toContain('Anthropic · opus-4.7')
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

  it('shows provider retry status without crowding the provider/model label', async () => {
    const handle = renderWithViewport(
      <StatusPanel
        {...baseProps}
        mode="running"
        providerName="Xiaomi Mimo"
        model="mimo-v2-pro"
        providerRetry={{ attempt: 1, delayMs: 1250 }}
        layout="compact"
        iconMode="text"
      />,
      { cols: 76, rows: 6 },
    )
    try {
      await new Promise<void>(resolve => setImmediate(resolve))
      const f = handle.lastFrame() ?? ''
      expect(f).toContain('retry: attempt 2 in 1.3s')
      expect(f).toContain('Xiaomi Mimo · mimo-v2-pro')
      expect(f).not.toContain('socket reset')
    } finally {
      handle.unmount()
    }
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
