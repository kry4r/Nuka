// test/tui/welcome.test.tsx
// Phase A — LogoV2 layout: 80-col threshold, NUKA title, two-column normal.
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import stripAnsi from 'strip-ansi'
import { Welcome } from '../../src/tui/Welcome/Welcome'

describe('Welcome', () => {
  it('renders NUKA title, model, cwd, branch in normal mode', () => {
    const { lastFrame } = render(
      <Welcome
        cwd="/workspace/proj"
        gitBranch={{ branch: 'main', dirty: false }}
        model="claude-sonnet-4-6"
        version="0.1.0"
        tip="Which bug are we slicing today?"
        updates={[]}
        recent={[]}
        columnsOverride={120}
        rowsOverride={40}
      />,
    )
    const frame = stripAnsi(lastFrame() ?? '')
    expect(frame).toContain('NUKA')
    expect(frame).toContain('v0.1.0')
    expect(frame).toContain('/ for commands')
    expect(frame).toContain('/workspace/proj')
    expect(frame).toContain('main')
    expect(frame).toContain('claude-sonnet-4-6')
  })

  it('renders Updates and Recent panels in normal mode', () => {
    const { lastFrame } = render(
      <Welcome
        cwd="/workspace/proj"
        gitBranch={null}
        model="claude-3"
        version="0.1.0"
        tip=""
        updates={[{ title: 'v2.0', bullets: ['New feature'] }]}
        recent={[{ id: 'sess-1', preview: 'Fix the bug', updatedAt: Date.now() }]}
        columnsOverride={120}
        rowsOverride={40}
      />,
    )
    const frame = stripAnsi(lastFrame() ?? '')
    expect(frame).toContain('Updates')
    expect(frame).toContain('Recent')
    expect(frame).toContain('v2.0')
    expect(frame).toContain('Fix the bug')
  })

  it('renders empty state placeholders when no data', () => {
    const { lastFrame } = render(
      <Welcome
        cwd="/workspace"
        gitBranch={null}
        model="claude"
        version="0.1.0"
        tip=""
        updates={[]}
        recent={[]}
        columnsOverride={120}
        rowsOverride={40}
      />,
    )
    const frame = stripAnsi(lastFrame() ?? '')
    expect(frame).toContain('(no updates)')
    expect(frame).toContain('(no recent sessions)')
  })

  it('hides right column in compact mode (<80 cols)', () => {
    const { lastFrame } = render(
      <Welcome
        cwd="/workspace"
        gitBranch={null}
        model="claude"
        version="0.1.0"
        tip=""
        updates={[{ title: 'v2.0' }]}
        recent={[{ id: 'sess-1', preview: 'Fix the bug', updatedAt: Date.now() }]}
        columnsOverride={70}
        rowsOverride={24}
      />,
    )
    const frame = stripAnsi(lastFrame() ?? '')
    expect(frame).toContain('NUKA')
    expect(frame).toContain('/ for commands')
    expect(frame).not.toContain('Updates')
    expect(frame).not.toContain('Recent')
  })
})
