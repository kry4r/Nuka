// test/tui/toolCall.test.tsx
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import stripAnsi from 'strip-ansi'
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

  it('contains long progress lines within column-aware box width (no border bleed)', () => {
    const orig = process.stdout.columns
    Object.defineProperty(process.stdout, 'columns', { value: 60, configurable: true })
    try {
      const progressLines = Array.from({ length: 12 }, () => 'x'.repeat(180))
      const { lastFrame } = render(
        <ToolCall name="Bash" argSummary="cmd" status="running" progressLines={progressLines} />,
      )
      const f = stripAnsi(lastFrame() ?? '')
      const maxLine = Math.max(...f.split('\n').map(s => s.length))
      // boxWidth = columns-4 = 56, total visible = 56 (no marginLeft on outer Box).
      // Allow slack for trailing whitespace.
      expect(maxLine).toBeLessThanOrEqual(60)
    } finally {
      Object.defineProperty(process.stdout, 'columns', { value: orig, configurable: true })
    }
  })
})
