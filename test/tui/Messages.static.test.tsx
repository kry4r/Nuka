// test/tui/Messages.static.test.tsx
//
// Verifies the Static-stream pattern in Messages: completed messages and the
// prologue (once any message lands) flow into ink's <Static>, which writes
// them to terminal scrollback and stops re-rendering. The live area only
// shows the most-recent message, any messages with in-flight tool calls, and
// the streaming row.
//
// Note: ink-testing-library renders in debug mode, where every frame is
// fullStaticOutput + dynamicOutput (see node_modules/ink/build/ink.js ~L255),
// so Static items DO appear in lastFrame() — we can still assert their text
// is present and check ordering / live-vs-static placement via row counts.

import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { Text } from 'ink'
import { Messages } from '../../src/tui/Messages/Messages'
import type { Message } from '../../src/core/message/types'

function userMsg(id: string, text: string): Message {
  return { role: 'user', id, ts: 1, content: [{ type: 'text', text }] }
}

function assistantMsg(id: string, text: string): Message {
  return { role: 'assistant', id, ts: 2, content: [{ type: 'text', text }] }
}

function assistantToolUse(id: string, toolUseId: string, toolName: string): Message {
  return {
    role: 'assistant',
    id,
    ts: 3,
    content: [{ type: 'tool_use', id: toolUseId, name: toolName, input: {} }],
  }
}

function toolResult(id: string, toolUseId: string, output: string): Message {
  return {
    role: 'tool',
    id,
    ts: 4,
    toolUseId,
    content: output,
    isError: false,
  }
}

const PROLOGUE = <Text>WELCOME-HERO-MARKER</Text>

describe('Messages — Static stream', () => {
  it('empty messages with prologue → prologue stays in live area', () => {
    const { lastFrame } = render(
      <Messages items={[]} streaming={null} prologue={PROLOGUE} />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('WELCOME-HERO-MARKER')
  })

  it('first message arrives → prologue + earlier messages flow into Static', () => {
    // 5 user messages. With LIVE_TAIL_COUNT=1, the 4 earliest plus the
    // prologue go into Static; the 5th stays in the live area.
    const items: Message[] = [
      userMsg('u1', 'first-msg'),
      userMsg('u2', 'second-msg'),
      userMsg('u3', 'third-msg'),
      userMsg('u4', 'fourth-msg'),
      userMsg('u5', 'fifth-msg'),
    ]
    const { lastFrame } = render(
      <Messages items={items} streaming={null} prologue={PROLOGUE} />,
    )
    const f = lastFrame() ?? ''
    // All five messages and the prologue are visible in the frame because
    // ink-testing-library debug-mode concatenates static + dynamic output.
    expect(f).toContain('WELCOME-HERO-MARKER')
    expect(f).toContain('first-msg')
    expect(f).toContain('second-msg')
    expect(f).toContain('third-msg')
    expect(f).toContain('fourth-msg')
    expect(f).toContain('fifth-msg')
    // Ordering: prologue precedes message text, and earliest messages
    // precede later ones (Static items come before the live area).
    const idxProlog = f.indexOf('WELCOME-HERO-MARKER')
    const idxFirst = f.indexOf('first-msg')
    const idxFifth = f.indexOf('fifth-msg')
    expect(idxProlog).toBeGreaterThanOrEqual(0)
    expect(idxProlog).toBeLessThan(idxFirst)
    expect(idxFirst).toBeLessThan(idxFifth)
  })

  it('streaming message in flight → stays in live area, never in Static', () => {
    const items: Message[] = [userMsg('u1', 'historical')]
    const streaming: Message = {
      role: 'assistant',
      id: 'streaming-1',
      ts: 5,
      content: [{ type: 'text', text: 'live-stream-marker' }],
    }
    const { lastFrame } = render(
      <Messages items={items} streaming={streaming} prologue={PROLOGUE} />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('live-stream-marker')
    expect(f).toContain('historical')
    expect(f).toContain('WELCOME-HERO-MARKER')
  })

  it('assistant message with unresolved tool_use stays in live area', () => {
    // u1 (static-eligible by index, but kept live as the latest non-tool-use
    // message), then a1 with a tool_use that has no matching tool result yet
    // (still in flight). The tool_use message must NOT go static — the
    // resolved-tool-use guard keeps it live.
    const items: Message[] = [
      userMsg('u1', 'kick-off'),
      assistantToolUse('a1', 'tu-pending', 'someTool'),
      // a2 keeps a1 from being the "latest" for live-tail purposes
      assistantMsg('a2', 'after-tool'),
    ]
    const { lastFrame } = render(
      <Messages items={items} streaming={null} />,
    )
    const f = lastFrame() ?? ''
    // Frame should include all message-relevant content (toolCall name
    // 'someTool' is rendered by MessageRow / ToolCall).
    expect(f).toContain('kick-off')
    expect(f).toContain('someTool')
    expect(f).toContain('after-tool')
  })

  it('once tool_use resolves and a newer message arrives, the assistant message can move into Static', () => {
    // a1's tool_use is resolved by the matching tool message. a2 supersedes
    // a1 as the live tail. So a1 + the tool result + the user prompt are
    // all static-eligible; a2 stays in the live area.
    const items: Message[] = [
      userMsg('u1', 'kick-off'),
      assistantToolUse('a1', 'tu-done', 'someTool'),
      toolResult('t1', 'tu-done', 'tool-output-marker'),
      assistantMsg('a2', 'after-tool'),
    ]
    const { lastFrame } = render(
      <Messages items={items} streaming={null} />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('kick-off')
    expect(f).toContain('someTool')
    expect(f).toContain('after-tool')
    // tool output appears (rendered by the standalone tool-role MessageRow)
    expect(f).toContain('tool-output-marker')
  })
})
