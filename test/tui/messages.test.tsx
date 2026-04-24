// test/tui/messages.test.tsx
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { Messages } from '../../src/tui/Messages/Messages'
import type { Message } from '../../src/core/message/types'

const sample: Message[] = [
  { role: 'user', id: 'u1', ts: 1, content: [{ type: 'text', text: 'hello' }] },
  { role: 'assistant', id: 'a1', ts: 2, content: [{ type: 'text', text: 'hi there' }] },
]

describe('Messages', () => {
  it('renders a user and assistant row', () => {
    const { lastFrame } = render(<Messages items={sample} streaming={null} />)
    const f = lastFrame() ?? ''
    expect(f).toContain('hello')
    expect(f).toContain('hi there')
    expect(f).toContain('you')
    expect(f).toContain('nuka')
  })

  it('renders ToolCall for tool_use content blocks', () => {
    const items: Message[] = [
      {
        role: 'assistant',
        id: 'a2',
        ts: 3,
        content: [
          { type: 'tool_use', id: 'tu1', name: 'mcp__fs__read', input: { path: '/tmp/x' } },
        ],
      },
    ]
    const { lastFrame } = render(
      <Messages
        items={items}
        streaming={null}
        resolveToolSource={() => 'mcp'}
      />,
    )
    const f = lastFrame() ?? ''
    // MCP tools render as "server · tool" format
    expect(f).toContain('fs · read')
    expect(f).toContain('[mcp]')
  })
})
