// test/tui/StatusLine/StatusLine.test.tsx
import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render } from 'ink-testing-library'
import { StatusLine } from '../../../src/tui/StatusLine/StatusLine'
import type { StatusLineCtx } from '../../../src/tui/StatusLine/template'

const ctx: StatusLineCtx = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  ctxPct: 10,
  cost: 0.001,
  plugins: 2,
  tasks: 0,
  branch: 'main',
}

afterEach(() => vi.restoreAllMocks())

describe('StatusLine', () => {
  it('renders a formatted string with provider and model', () => {
    const { lastFrame } = render(
      <StatusLine
        config={{ format: '{provider}/{model}', intervalMs: 5000 }}
        ctx={ctx}
      />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('anthropic/claude-sonnet-4-6')
  })

  it('renders the default format when no format specified', () => {
    const { lastFrame } = render(
      <StatusLine config={{ intervalMs: 5000 }} ctx={ctx} />,
    )
    const f = lastFrame() ?? ''
    // Default format includes provider and model
    expect(f).toContain('anthropic')
    expect(f).toContain('claude-sonnet-4-6')
  })

  it('renders {branch} token', () => {
    const { lastFrame } = render(
      <StatusLine config={{ format: 'branch:{branch}', intervalMs: 5000 }} ctx={ctx} />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('branch:main')
  })

  it('renders — when branch is null', () => {
    const { lastFrame } = render(
      <StatusLine config={{ format: '{branch}', intervalMs: 5000 }} ctx={{ ...ctx, branch: null }} />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('—')
  })

  it('renders with command mock (mock exec)', async () => {
    // Mock exec to return immediately with a line
    vi.mock('node:child_process', async (importOriginal) => {
      const orig = await importOriginal<typeof import('node:child_process')>()
      return {
        ...orig,
        exec: vi.fn((cmd: string, opts: any, cb: (err: null, stdout: string) => void) => {
          cb(null, 'git-output\n')
          return {} as any
        }),
      }
    })

    const { lastFrame } = render(
      <StatusLine
        config={{ format: '{model}', command: 'echo test', intervalMs: 100 }}
        ctx={ctx}
      />,
    )
    // Initial render without command output
    const f = lastFrame() ?? ''
    expect(f).toContain('claude-sonnet-4-6')
  })

  it('renders undefined config gracefully', () => {
    const { lastFrame } = render(
      <StatusLine config={undefined} ctx={ctx} />,
    )
    const f = lastFrame() ?? ''
    // With undefined config, template uses defaults with actual ctx values
    expect(typeof f).toBe('string')
  })
})
