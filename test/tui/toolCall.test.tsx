// test/tui/toolCall.test.tsx
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { ToolCall } from '../../src/tui/Messages/ToolCall'

describe('ToolCall', () => {
  it('renders without progress lines', () => {
    const { lastFrame } = render(
      <ToolCall name="Bash" argSummary="echo hello" status="ok" />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('Bash')
    expect(f).toContain('echo hello')
    expect(f).toContain('✓')
  })

  it('shows progress lines when running', () => {
    const { lastFrame } = render(
      <ToolCall
        name="Bash"
        argSummary="long cmd"
        status="running"
        progressLines={['line one', 'line two']}
      />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('line one')
    expect(f).toContain('line two')
  })

  it('shows tail of progress lines when completed', () => {
    const { lastFrame } = render(
      <ToolCall
        name="Bash"
        argSummary="cmd"
        status="ok"
        progressLines={['a', 'b', 'c']}
      />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('a')
    expect(f).toContain('b')
    expect(f).toContain('c')
  })

  it('omits progress box when progressLines is empty', () => {
    const { lastFrame } = render(
      <ToolCall name="Bash" argSummary="cmd" status="running" progressLines={[]} />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('Bash')
    // No border characters from the progress box
    expect(f).not.toContain('─')
  })

  it('renders [mcp] badge and server·tool display when source is mcp', () => {
    const { lastFrame } = render(
      <ToolCall name="mcp__github__listRepos" argSummary="{}" status="ok" source="mcp" />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('[mcp]')
    // Should show "github · listRepos" not the raw namespaced name
    expect(f).toContain('github')
    expect(f).toContain('listRepos')
    expect(f).not.toContain('mcp__github__listRepos')
  })

  it('renders server · tool format for mcp tools', () => {
    const { lastFrame } = render(
      <ToolCall name="mcp__github__listRepos" argSummary="{}" status="ok" source="mcp" />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('github · listRepos')
  })

  it('falls back to raw name for mcp source when name is not parseable', () => {
    const { lastFrame } = render(
      <ToolCall name="notAnMcpName" argSummary="{}" status="ok" source="mcp" />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('notAnMcpName')
  })

  it('renders no badge when source is undefined', () => {
    const { lastFrame } = render(
      <ToolCall name="Bash" argSummary="cmd" status="ok" />,
    )
    const f = lastFrame() ?? ''
    expect(f).not.toContain('[')
  })

  it('renders no badge when source is builtin', () => {
    const { lastFrame } = render(
      <ToolCall name="Read" argSummary="file.ts" status="ok" source="builtin" />,
    )
    const f = lastFrame() ?? ''
    expect(f).not.toContain('[builtin]')
  })

  it('renders [plugin] badge when source is plugin', () => {
    const { lastFrame } = render(
      <ToolCall name="plugin__demo__doThing" argSummary="{}" status="ok" source="plugin" />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('[plugin]')
  })

  it('renders [skill] badge when source is skill', () => {
    const { lastFrame } = render(
      <ToolCall name="RunSkill" argSummary="{}" status="ok" source="skill" />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('[skill]')
  })

  it('renders (network) suffix when annotations.openWorld is true', () => {
    const { lastFrame } = render(
      <ToolCall
        name="WebSearch"
        argSummary="{}"
        status="ok"
        annotations={{ openWorld: true }}
      />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('(network)')
  })

  it('does not render (network) suffix when annotations.openWorld is false/absent', () => {
    const { lastFrame } = render(
      <ToolCall name="ReadFile" argSummary="{}" status="ok" annotations={{ readOnly: true }} />,
    )
    const f = lastFrame() ?? ''
    expect(f).not.toContain('(network)')
  })

  it('does not render (network) suffix when annotations prop is absent', () => {
    const { lastFrame } = render(
      <ToolCall name="Bash" argSummary="echo hi" status="ok" />,
    )
    const f = lastFrame() ?? ''
    expect(f).not.toContain('(network)')
  })
})
