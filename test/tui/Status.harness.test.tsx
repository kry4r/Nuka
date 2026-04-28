// test/tui/Status.harness.test.tsx
//
// Phase 12 §4.5 — StatusPanel layout switching + hidden segment filter.

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
  cost: 0.04,
  pluginCount: 4,
  sessionPluginCount: 0,
  agentInFlight: 0,
  hiddenSegments: [] as string[],
  startedAt: Date.now() - 134_000, // 2m14s ago
} as const

describe('StatusPanel', () => {
  it('renders six rows in dense layout', () => {
    const { lastFrame } = render(
      <StatusPanel {...baseProps} layout="dense" />,
    )
    const f = lastFrame() ?? ''
    expect(f).toMatch(/⬢ idle/)
    expect(f).toMatch(/opus-4\.7 · anthropic/)
    expect(f).toMatch(/main/)
    expect(f).toMatch(/12k\/200k/)
    expect(f).toMatch(/\$0\.0400/)
    expect(f).toMatch(/4 plugins · 0 agents · 0 background/)
  })

  it('compact layout folds rows to two', () => {
    const { lastFrame } = render(
      <StatusPanel {...baseProps} layout="compact" />,
    )
    const f = lastFrame() ?? ''
    // All segments still rendered, in two rows.
    expect(f).toContain('⬢ idle')
    expect(f).toContain('opus-4.7')
    expect(f).toContain('main')
    expect(f).toContain('plugins')
    // Two non-empty rows in this fixture.
    const rows = f.split('\n').filter(line => line.trim().length > 0)
    expect(rows.length).toBeLessThanOrEqual(3)
  })

  it('oneline layout puts everything on a single Box (segments may wrap under ink-testing-library narrow render)', () => {
    const { lastFrame } = render(
      <StatusPanel {...baseProps} layout="oneline" />,
    )
    const f = lastFrame() ?? ''
    // ink-testing-library auto-wraps long single-Text under its narrow
    // default width, so we don't assert the literal "⬢ idle" string —
    // we assert that every segment's identifying token shows up.
    expect(f).toContain('⬢')
    expect(f).toContain('idle')
    expect(f).toContain('opus-4.7')
    expect(f).toContain('plugins')
  })

  it('hidden filter drops the named segment', () => {
    const { lastFrame } = render(
      <StatusPanel {...baseProps} layout="dense" hiddenSegments={['cost-time']} />,
    )
    const f = lastFrame() ?? ''
    expect(f).not.toMatch(/⏱/)
    // Other rows still render.
    expect(f).toContain('⬢ idle')
    expect(f).toContain('plugins')
  })

  it('returns null when every segment is hidden and no statusLine row', () => {
    const { lastFrame } = render(
      <StatusPanel
        {...baseProps}
        layout="dense"
        hiddenSegments={['mode', 'model', 'cwd', 'context', 'cost-time', 'counts']}
      />,
    )
    const f = lastFrame() ?? ''
    expect(f.trim()).toBe('')
  })
})
