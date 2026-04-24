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
})
