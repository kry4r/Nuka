// test/tui/Tasks/SubagentList.test.tsx
//
// Phase 12 M3 — unit tests for SubagentList component and
// findInFlightSubagents helper.

import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { SubagentList, findInFlightSubagents } from '../../../src/tui/Tasks/SubagentList'
import type { Message } from '../../../src/core/message/types'
import { DISPATCH_AGENT_TOOL_NAME } from '../../../src/core/agents/dispatchTool'

function makeToolUseMsg(id: string, task: string): Message {
  return {
    role: 'assistant',
    content: [{
      type: 'tool_use',
      id,
      name: DISPATCH_AGENT_TOOL_NAME,
      input: { agent: 'test:agent', task },
    }],
    id: `msg-${id}`,
    ts: Date.now(),
  }
}

function makeToolResultMsg(toolUseId: string): Message {
  return {
    role: 'tool',
    toolUseId,
    content: 'done',
    isError: false,
    id: `result-${toolUseId}`,
    ts: Date.now(),
  }
}

describe('findInFlightSubagents', () => {
  it('returns empty when no messages', () => {
    expect(findInFlightSubagents([])).toHaveLength(0)
  })

  it('returns empty when dispatch_agent has a matching tool result', () => {
    const msgs: Message[] = [
      makeToolUseMsg('id1', 'task one'),
      makeToolResultMsg('id1'),
    ]
    expect(findInFlightSubagents(msgs)).toHaveLength(0)
  })

  it('returns in-flight dispatch_agent calls without tool results', () => {
    const msgs: Message[] = [
      makeToolUseMsg('id1', 'task one'),
      makeToolUseMsg('id2', 'task two'),
      makeToolResultMsg('id1'), // id1 is resolved, id2 is not
    ]
    const result = findInFlightSubagents(msgs)
    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe('id2')
    expect(result[0]!.label).toContain('task two')
  })

  it('returns most-recent in-flight first', () => {
    const msgs: Message[] = [
      makeToolUseMsg('id-first', 'older task'),
      makeToolUseMsg('id-second', 'newer task'),
    ]
    const result = findInFlightSubagents(msgs)
    expect(result).toHaveLength(2)
    // Most recent first: id-second was added last
    expect(result[0]!.id).toBe('id-second')
    expect(result[1]!.id).toBe('id-first')
  })

  it('truncates long task labels to 60 chars + ellipsis', () => {
    const longTask = 'a'.repeat(80)
    const msgs: Message[] = [makeToolUseMsg('id1', longTask)]
    const result = findInFlightSubagents(msgs)
    expect(result[0]!.label).toHaveLength(61) // 60 + '…'
    expect(result[0]!.label.endsWith('…')).toBe(true)
  })
})

describe('SubagentList', () => {
  it('returns null when no in-flight subagents', () => {
    const { lastFrame } = render(
      React.createElement(SubagentList, { messages: [], maxItems: 10 })
    )
    expect(lastFrame()).toBe('')
  })

  it('renders in-flight subagents with ▶ icon and Subagents heading', () => {
    const msgs: Message[] = [
      makeToolUseMsg('id1', 'Analyze the codebase'),
    ]
    const { lastFrame } = render(
      React.createElement(SubagentList, { messages: msgs, maxItems: 10 })
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('Subagents')
    expect(f).toContain('▶')
    expect(f).toContain('Analyze the codebase')
  })

  it('shows overflow ellipsis when agents exceed maxItems', () => {
    const msgs: Message[] = Array.from({ length: 5 }, (_, i) =>
      makeToolUseMsg(`id${i}`, `task ${i}`)
    )
    const { lastFrame } = render(
      React.createElement(SubagentList, { messages: msgs, maxItems: 2 })
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('… +3 more')
  })
})
