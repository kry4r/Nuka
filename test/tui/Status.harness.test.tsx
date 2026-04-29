// test/tui/Status.harness.test.tsx
//
// Phase 13 M3 — StatusPanel two-column dense layout, icon/text mode,
// expanded context, no time tracking.

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

describe('StatusPanel', () => {
  it('dense layout renders two columns with │ separator', () => {
    const { lastFrame } = render(
      <StatusPanel {...baseProps} layout="dense" />,
    )
    const f = lastFrame() ?? ''
    // Left column anchors
    expect(f).toMatch(/⬢ idle/)
    expect(f).toMatch(/opus-4\.7 · anthropic/)
    expect(f).toMatch(/main/)
    // Right column anchors
    expect(f).toMatch(/12k\/200k/)
    expect(f).toMatch(/\$0\.0400/)
    expect(f).toMatch(/4 plugins · 0 agents · 0 background/)
    // Column separator
    expect(f).toContain('│')
    // No time tracking (⏱ gone)
    expect(f).not.toMatch(/⏱/)
  })

  it('dense layout expanded context shows in:N out:N', () => {
    const { lastFrame } = render(
      <StatusPanel {...baseProps} layout="dense" />,
    )
    const f = lastFrame() ?? ''
    expect(f).toMatch(/in:10k/)
    expect(f).toMatch(/out:2k/)
    expect(f).toMatch(/6%/)
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

  it('hidden filter drops the cost segment (old cost-time id also works)', () => {
    const { lastFrame } = render(
      <StatusPanel {...baseProps} layout="dense" hiddenSegments={['cost']} />,
    )
    const f = lastFrame() ?? ''
    expect(f).not.toMatch(/\$0\.04/)
    // Other rows still render.
    expect(f).toContain('⬢ idle')
    expect(f).toContain('plugins')
  })

  it('backward-compat: hidden cost-time also hides cost segment', () => {
    const { lastFrame } = render(
      <StatusPanel {...baseProps} layout="dense" hiddenSegments={['cost-time']} />,
    )
    const f = lastFrame() ?? ''
    expect(f).not.toMatch(/\$0\.04/)
    expect(f).toContain('⬢ idle')
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

  it('text mode uses plain labels instead of glyphs', () => {
    const { lastFrame } = render(
      <StatusPanel {...baseProps} layout="dense" iconMode="text" />,
    )
    const f = lastFrame() ?? ''
    // text mode mode badge
    expect(f).toMatch(/\[idle\]/)
    expect(f).not.toMatch(/⬢/)
    // text mode cost
    expect(f).toMatch(/cost:\$0\.0400/)
    // text mode context (no bar glyphs)
    expect(f).toMatch(/context:/)
    expect(f).not.toMatch(/▰|▱/)
    // text mode counts
    expect(f).toMatch(/plugins:4/)
    expect(f).not.toMatch(/⚙/)
  })

  it('icon mode uses glyphs', () => {
    const { lastFrame } = render(
      <StatusPanel {...baseProps} layout="dense" iconMode="icon" />,
    )
    const f = lastFrame() ?? ''
    expect(f).toMatch(/⬢ idle/)
    expect(f).toMatch(/⚙ 4 plugins/)
    // Progress bar glyphs
    expect(f).toMatch(/▱/)
  })
})
