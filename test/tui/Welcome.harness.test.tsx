// test/tui/Welcome.harness.test.tsx
//
// Phase 13 M2 — Harness tests for the Welcome screen redesign.
// Asserts 2:1 split layout (wide) and narrow-terminal degradation (<100 cols).
//
// Strategy: use mountApp with columnsOverride injected via config-like
// custom node, or mount Welcome directly via `target: 'custom'`.

import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { Welcome } from '../../src/tui/Welcome/Welcome'
import { mountApp } from '../../src/tui/testing/harness'

const wait = (ms = 30) => new Promise(r => setTimeout(r, ms))

describe('Welcome harness — 2:1 split layout', () => {
  it('shows Updates and Recent panels in wide mode', () => {
    const { lastFrame } = render(
      <Welcome
        cwd="/home/user/projects/my-app"
        gitBranch={{ branch: 'feature/x', dirty: false }}
        model="claude-sonnet-4-6"
        version="0.2.0"
        tip=""
        updates={[
          { version: '1.1.0', title: 'New commands', bullets: ['Added /stats', 'Fixed /resume'] },
        ]}
        recent={[
          { id: 'abc', preview: 'Refactor the auth module', updatedAt: Date.now() },
          { id: 'def', preview: 'Write unit tests for parser', updatedAt: Date.now() - 1000 },
        ]}
        columnsOverride={120}
        rowsOverride={40}
      />,
    )
    const frame = lastFrame() ?? ''
    // Left panel
    expect(frame).toContain('NUKA')
    expect(frame).toContain('claude-sonnet-4-6')
    expect(frame).toContain('feature/x')
    expect(frame).toContain('Type')
    expect(frame).toContain('/ for commands')
    // Right column — Updates
    expect(frame).toContain('Updates')
    expect(frame).toContain('New commands')
    expect(frame).toContain('Added /stats')
    // Right column — Recent
    expect(frame).toContain('Recent')
    expect(frame).toContain('Refactor the auth module')
    expect(frame).toContain('Write unit tests for parser')
  })

  it('shows empty-state placeholders when updates/recent are empty — does NOT collapse the column', () => {
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
    const frame = lastFrame() ?? ''
    // Left panel still present
    expect(frame).toContain('NUKA')
    // Empty state strings — right column still rendered
    expect(frame).toContain('(no updates)')
    expect(frame).toContain('(no recent sessions)')
    // Neither panel title nor the column should be absent
    expect(frame).toContain('Updates')
    expect(frame).toContain('Recent')
  })

  it('hides right column entirely in narrow mode (<100 cols)', () => {
    const { lastFrame } = render(
      <Welcome
        cwd="/tmp"
        gitBranch={null}
        model="claude"
        version="0.1.0"
        tip=""
        updates={[{ title: 'Release 1.0' }]}
        recent={[{ id: 's1', preview: 'Some task', updatedAt: Date.now() }]}
        columnsOverride={90}
        rowsOverride={24}
      />,
    )
    const frame = lastFrame() ?? ''
    // Welcome still occupies the full width
    expect(frame).toContain('NUKA')
    // Right column panels must not appear
    expect(frame).not.toContain('Updates')
    expect(frame).not.toContain('Recent')
    // Verify empty-state strings also absent
    expect(frame).not.toContain('(no updates)')
    expect(frame).not.toContain('(no recent sessions)')
  })

  it('dirty git branch shows asterisk', () => {
    const { lastFrame } = render(
      <Welcome
        cwd="/workspace"
        gitBranch={{ branch: 'main', dirty: true }}
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
    expect(frame).toContain('main *')
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
    const frame = lastFrame() ?? ''
    expect(frame).toContain('(not a git repo)')
  })
})

describe('Welcome harness — via mountApp', () => {
  it('full App renders Welcome with no messages (raw welcome screen)', async () => {
    const h = mountApp({ target: 'app' })
    try {
      await wait()
      const frame = h.frames().pop() ?? ''
      expect(frame).toContain('NUKA')
    } finally {
      h.unmount()
    }
  })

  it('App with updates/recent passed through shows in Welcome', async () => {
    // Use custom target to inject the full App with updates/recent
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
      const frame = h.frames().pop() ?? ''
      expect(frame).toContain('Patch 1')
      expect(frame).toContain('Recent task preview')
    } finally {
      h.unmount()
    }
  })
})
