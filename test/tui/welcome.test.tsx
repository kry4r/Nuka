// test/tui/welcome.test.tsx
// Phase 13 M2 — updated to match new Welcome layout (tip prop is still
// accepted for compat but is no longer rendered in the new design).
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { Welcome } from '../../src/tui/Welcome/Welcome'

describe('Welcome', () => {
  it('renders NUKA brand, model, cwd, and branch in wide mode', () => {
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
    const frame = lastFrame() ?? ''
    // 3D NUKA logo replaces the prior text wordmark — assert hero meta line
    // and the "Type / for commands" hint instead of literal "NUKA" text.
    expect(frame).toContain('/ for commands')
    expect(frame).toContain('/workspace/proj')
    expect(frame).toContain('main')
    expect(frame).toContain('claude-sonnet-4-6')
  })

  it('renders Updates and Recent panels in wide mode', () => {
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
    const frame = lastFrame() ?? ''
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
    const frame = lastFrame() ?? ''
    expect(frame).toContain('(no updates)')
    expect(frame).toContain('(no recent sessions)')
  })

  it('hides right column in narrow mode (<100 cols)', () => {
    const { lastFrame } = render(
      <Welcome
        cwd="/workspace"
        gitBranch={null}
        model="claude"
        version="0.1.0"
        tip=""
        updates={[{ title: 'v2.0' }]}
        recent={[{ id: 'sess-1', preview: 'Fix the bug', updatedAt: Date.now() }]}
        columnsOverride={80}
        rowsOverride={24}
      />,
    )
    const frame = lastFrame() ?? ''
    // Hero (left panel) still shown — assert hint text instead of removed "NUKA" wordmark.
    expect(frame).toContain('/ for commands')
    // Right column panels hidden
    expect(frame).not.toContain('Updates')
    expect(frame).not.toContain('Recent')
  })
})
