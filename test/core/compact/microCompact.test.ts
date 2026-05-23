import { describe, expect, it } from 'vitest'
import {
  MICROCOMPACT_CLEARED_TOOL_RESULT,
  microcompactToolResults,
} from '../../../src/core/compact/microCompact'
import type { AssistantMessage, Message, ToolMessage } from '../../../src/core/message/types'

let idCounter = 0
function nextId(): string {
  idCounter += 1
  return `m${idCounter}`
}

function assistantToolUse(toolUseId: string, name: string): AssistantMessage {
  return {
    role: 'assistant',
    id: nextId(),
    ts: idCounter,
    content: [{ type: 'tool_use', id: toolUseId, name, input: { path: 'a.ts' } }],
  }
}

function tool(toolUseId: string, output: string): ToolMessage {
  return {
    role: 'tool',
    toolUseId,
    content: output,
    isError: false,
    id: nextId(),
    ts: idCounter,
  }
}

describe('microcompactToolResults', () => {
  it('clears older allowlisted tool results while keeping the most recent N', () => {
    const messages: Message[] = [
      assistantToolUse('call_1', 'Read'),
      tool('call_1', 'old read result'),
      assistantToolUse('call_2', 'Bash'),
      tool('call_2', 'recent bash result'),
      assistantToolUse('call_3', 'Read'),
      tool('call_3', 'newest read result'),
    ]

    const result = microcompactToolResults(messages, { keepRecent: 2 })

    expect(result.compacted).toBe(true)
    expect(result.clearedToolUseIds).toEqual(['call_1'])
    expect(result.keptToolUseIds).toEqual(['call_2', 'call_3'])
    expect((result.messages[1] as ToolMessage).content).toBe(MICROCOMPACT_CLEARED_TOOL_RESULT)
    expect((result.messages[3] as ToolMessage).content).toBe('recent bash result')
    expect((result.messages[5] as ToolMessage).content).toBe('newest read result')
  })

  it('ignores tool results whose tool_use name is not allowlisted', () => {
    const messages: Message[] = [
      assistantToolUse('call_1', 'CustomTool'),
      tool('call_1', 'custom payload'),
      assistantToolUse('call_2', 'Read'),
      tool('call_2', 'read payload'),
    ]

    const result = microcompactToolResults(messages, {
      keepRecent: 0,
      compactableTools: new Set(['Read']),
    })

    expect(result.compacted).toBe(true)
    expect(result.clearedToolUseIds).toEqual(['call_2'])
    expect((result.messages[1] as ToolMessage).content).toBe('custom payload')
    expect((result.messages[3] as ToolMessage).content).toBe(MICROCOMPACT_CLEARED_TOOL_RESULT)
  })

  it('does not mutate the input messages', () => {
    const messages: Message[] = [
      assistantToolUse('call_1', 'Read'),
      tool('call_1', 'old read result'),
      assistantToolUse('call_2', 'Read'),
      tool('call_2', 'new read result'),
    ]
    const snapshot = structuredClone(messages)

    microcompactToolResults(messages, { keepRecent: 1 })

    expect(messages).toEqual(snapshot)
  })

  it('returns the original message references when nothing can be cleared', () => {
    const messages: Message[] = [
      assistantToolUse('call_1', 'Read'),
      tool('call_1', 'only result'),
    ]

    const result = microcompactToolResults(messages, { keepRecent: 5 })

    expect(result.compacted).toBe(false)
    expect(result.messages).toEqual(messages)
    expect(result.messages[0]).toBe(messages[0])
    expect(result.messages[1]).toBe(messages[1])
  })
})
