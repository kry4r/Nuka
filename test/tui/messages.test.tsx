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
})
