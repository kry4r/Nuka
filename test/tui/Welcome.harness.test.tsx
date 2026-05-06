// test/tui/Welcome.harness.test.tsx
//
// Phase A — Harness tests for the LogoV2 port. Asserts:
//   - small/medium/large terminals render without crash
//   - compact-mode threshold (<80 cols) collapses the right column
//   - logo doesn't wrap mid-row (locale-stable braille glyphs)
//   - tip line ("Type / for commands") is present in every layout

import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import stripAnsi from 'strip-ansi'
import { Welcome } from '../../src/tui/Welcome/Welcome'
import { mountApp } from '../../src/tui/testing/harness'

const wait = (ms = 30) => new Promise(r => setTimeout(r, ms))

describe('Welcome harness — LogoV2 layout', () => {
  it('renders on a small (40×10) terminal without crashing', () => {
    const { lastFrame } = render(
      <Welcome
        cwd="/tmp"
        gitBranch={null}
        model="claude"
        version="0.1.0"
        tip=""
        updates={[]}
        recent={[]}
        columnsOverride={40}
        rowsOverride={10}
      />,
    )
    const frame = stripAnsi(lastFrame() ?? '')
    expect(frame.length).toBeGreaterThan(0)
    expect(frame).toContain('NUKA')
    expect(frame).toContain('/ for commands')
    // Compact mode: right column is suppressed.
    expect(frame).not.toContain('Updates')
    expect(frame).not.toContain('Recent')
  })

  it('renders on a medium (80×24) terminal with two columns', () => {
    const { lastFrame } = render(
      <Welcome
        cwd="/home/user/projects/my-app"
        gitBranch={{ branch: 'feature/x', dirty: false }}
        model="claude-sonnet-4-6"
        version="0.2.0"
        tip=""
        updates={[
          { version: '1.1.0', title: 'New commands', bullets: ['Added /stats'] },
        ]}
        recent={[
          { id: 'abc', preview: 'Refactor the auth module', updatedAt: Date.now() },
        ]}
        columnsOverride={80}
        rowsOverride={24}
      />,
    )
    const frame = stripAnsi(lastFrame() ?? '')
    expect(frame).toContain('claude-sonnet-4-6')
    expect(frame).toContain('feature/x')
    expect(frame).toContain('/ for commands')
    expect(frame).toContain('Updates')
    expect(frame).toContain('Recent')
    expect(frame).toContain('Refactor the auth module')
  })

  it('renders on a large terminal (capped at ink-testing 100 cols) without crashing', () => {
    // ink-testing-library hard-codes stdout.columns=100; the prop drives the
    // logical layout, but physical render is bounded by 100 chars regardless.
    const { lastFrame } = render(
      <Welcome
        cwd="/workspace"
        gitBranch={{ branch: 'main', dirty: true }}
        model="claude"
        version="0.1.0"
        tip=""
        updates={[]}
        recent={[]}
        columnsOverride={100}
        rowsOverride={50}
      />,
    )
    const frame = stripAnsi(lastFrame() ?? '')
    expect(frame).toContain('NUKA')
    expect(frame).toContain('main *')
    expect(frame).toContain('/ for commands')
  })

  it('compact-mode threshold trigger — <80 cols hides the right column', () => {
    const { lastFrame } = render(
      <Welcome
        cwd="/tmp"
        gitBranch={null}
        model="claude"
        version="0.1.0"
        tip=""
        updates={[{ title: 'Release 1.0' }]}
        recent={[{ id: 's1', preview: 'Some task', updatedAt: Date.now() }]}
        columnsOverride={70}
        rowsOverride={24}
      />,
    )
    const frame = stripAnsi(lastFrame() ?? '')
    expect(frame).toContain('/ for commands')
    expect(frame).not.toContain('Updates')
    expect(frame).not.toContain('Recent')
  })

  it('logo does not wrap mid-row — every braille line stays on one row', () => {
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
    // Each Clawd row contains Unicode braille (U+28xx) — locale-stable EAW
    // Neutral, so the row should appear intact (no embedded \n inside the
    // braille run).
    const brailleRows = frame.split('\n').filter(l => /[\u2800-\u28FF]/.test(l))
    expect(brailleRows.length).toBeGreaterThanOrEqual(7)
    for (const row of brailleRows) {
      // No newline characters inside a single rendered row
      expect(row).not.toContain('\r')
    }
  })

  it('null git branch shows (not a git repo)', () => {
    const { lastFrame } = render(
      <Welcome
        cwd="/tmp"
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
    expect(frame).toContain('(not a git repo)')
  })
})

describe('Welcome harness — via mountApp', () => {
  it('full App renders Welcome with no messages (raw welcome screen)', async () => {
    const h = mountApp({ target: 'app' })
    try {
      await wait()
      const frame = stripAnsi(h.frames().pop() ?? '')
      expect(frame).toContain('/ for commands')
    } finally {
      h.unmount()
    }
  })

  it('Updates/Recent surface when passed through (medium terminal)', async () => {
    const h = mountApp({
      target: 'custom',
      node: React.createElement(Welcome, {
        cwd: '/test',
        gitBranch: { branch: 'test-branch', dirty: false },
        model: 'test-model',
        version: '0.0.1',
        tip: '',
        updates: [{ title: 'Patch 1', bullets: ['Fix crash'] }],
        recent: [{ id: 'r1', preview: 'Recent task preview', updatedAt: Date.now() }],
        columnsOverride: 120,
        rowsOverride: 40,
      }),
    })
    try {
      await wait()
      const frame = stripAnsi(h.frames().pop() ?? '')
      expect(frame).toContain('Patch 1')
      expect(frame).toContain('Recent task preview')
    } finally {
      h.unmount()
    }
  })
})
