// test/tui/agentCall.test.tsx
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { AgentCall } from '../../src/tui/Messages/AgentCall'
import { MessageRow } from '../../src/tui/Messages/MessageRow'
import type { AssistantMessage, Message, ToolMessage } from '../../src/core/message/types'
import { DISPATCH_AGENT_TOOL_NAME } from '../../src/core/agents/dispatchTool'
import { findLatestDispatchAgentCallId } from '../../src/tui/App'

describe('AgentCall', () => {
  it('renders the agent badge and task line', () => {
    const { lastFrame } = render(
      <AgentCall agent="core:reviewer" task="review the diff" status="ok" result="looks good" />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('[core:reviewer]')
    expect(f).toContain('review the diff')
    expect(f).toContain('✓')
    expect(f).toContain('looks good')
    expect(f).toContain('(from `core:reviewer`)')
  })

  it('shows running indicator when status is running', () => {
    const { lastFrame } = render(
      <AgentCall agent="core:reviewer" task="working" status="running" />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('…')
    expect(f).not.toContain('✓')
  })

  it('shows error mark when status is error', () => {
    const { lastFrame } = render(
      <AgentCall agent="core:tester" task="t" status="error" result="failed" />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('✗')
  })

  it('truncates long task text when collapsed and shows more when expanded', () => {
    const longTask = 'a'.repeat(200)
    const collapsed = render(
      <AgentCall agent="core:x" task={longTask} status="ok" result="done" expanded={false} />,
    )
    const fCollapsed = collapsed.lastFrame() ?? ''
    expect(fCollapsed).toContain('…')

    const expanded = render(
      <AgentCall agent="core:x" task={longTask} status="ok" result="done" expanded={true} />,
    )
    const fExp = expanded.lastFrame() ?? ''
    // The expanded variant should carry strictly more `a`s than the
    // collapsed one (ink may wrap long lines across rows).
    const countA = (s: string) => (s.match(/a/g) ?? []).length
    expect(countA(fExp)).toBeGreaterThan(countA(fCollapsed))
  })
})

describe('MessageRow integration with dispatch_agent', () => {
  it('renders a dispatch_agent tool_use as an AgentCall with the badge', () => {
    const msg: AssistantMessage = {
      role: 'assistant',
      id: 'a1',
      ts: 0,
      content: [
        {
          type: 'tool_use',
          id: 'd1',
          name: DISPATCH_AGENT_TOOL_NAME,
          input: { agent: 'core:reviewer', task: 'please review' },
        },
      ],
    }
    const results = new Map<string, { output: string; isError: boolean }>()
    results.set('d1', { output: 'LGTM', isError: false })
    const { lastFrame } = render(
      <MessageRow m={msg} toolResultsById={results} />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('[core:reviewer]')
    expect(f).toContain('please review')
    expect(f).toContain('LGTM')
    expect(f).toContain('(from `core:reviewer`)')
  })

  it('suppresses the standalone tool-role block for dispatch_agent ids', () => {
    const toolMsg: ToolMessage = {
      role: 'tool',
      id: 't1',
      ts: 0,
      toolUseId: 'd1',
      content: 'sub-agent output',
      isError: false,
    }
    const results = new Map<string, { output: string; isError: boolean }>([
      ['d1', { output: 'sub-agent output', isError: false }],
    ])
    const { lastFrame } = render(
      <MessageRow m={toolMsg} toolResultsById={results} />,
    )
    // The standalone "tool" speaker block is hidden because AgentCall
    // renders the result inline with the call.
    const f = lastFrame() ?? ''
    expect(f).not.toContain('▎ tool')
  })

  it('still renders non-dispatch_agent tool calls via ToolCall', () => {
    const msg: AssistantMessage = {
      role: 'assistant',
      id: 'a2',
      ts: 0,
      content: [
        { type: 'tool_use', id: 'r1', name: 'Read', input: { path: '/x' } },
      ],
    }
    const { lastFrame } = render(<MessageRow m={msg} />)
    const f = lastFrame() ?? ''
    expect(f).toContain('Read')
    expect(f).not.toContain('[core:')
  })

  it('findLatestDispatchAgentCallId returns the most recent dispatch_agent id', () => {
    const messages: Message[] = [
      {
        role: 'assistant', id: 'a1', ts: 0,
        content: [
          { type: 'tool_use', id: 'd1', name: DISPATCH_AGENT_TOOL_NAME, input: {} },
        ],
      },
      {
        role: 'assistant', id: 'a2', ts: 1,
        content: [
          { type: 'tool_use', id: 'r1', name: 'Read', input: {} },
          { type: 'tool_use', id: 'd2', name: DISPATCH_AGENT_TOOL_NAME, input: {} },
        ],
      },
    ]
    expect(findLatestDispatchAgentCallId(messages)).toBe('d2')
    expect(findLatestDispatchAgentCallId([])).toBeUndefined()
    expect(findLatestDispatchAgentCallId([
      { role: 'user', id: 'u', ts: 0, content: [{ type: 'text', text: 'hi' }] },
    ])).toBeUndefined()
  })

  it('respects expandedAgentCallIds prop to render AgentCall expanded', () => {
    const longTask = 'x'.repeat(200)
    const msg: AssistantMessage = {
      role: 'assistant',
      id: 'a3',
      ts: 0,
      content: [
        { type: 'tool_use', id: 'd-big', name: DISPATCH_AGENT_TOOL_NAME, input: { agent: 'core:r', task: longTask } },
      ],
    }
    const results = new Map<string, { output: string; isError: boolean }>([
      ['d-big', { output: 'done', isError: false }],
    ])
    const collapsed = render(<MessageRow m={msg} toolResultsById={results} />)
    const expanded = render(
      <MessageRow m={msg} toolResultsById={results} expandedAgentCallIds={new Set(['d-big'])} />,
    )
    const countX = (s: string) => (s.match(/x/g) ?? []).length
    expect(countX(expanded.lastFrame() ?? '')).toBeGreaterThan(countX(collapsed.lastFrame() ?? ''))
  })
})
