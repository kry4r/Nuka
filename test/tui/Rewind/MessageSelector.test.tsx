// test/tui/Rewind/MessageSelector.test.tsx
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import { MessageSelector } from '../../../src/tui/Rewind/MessageSelector'
import type { AssistantMessage } from '../../../src/core/message/types'

const flush = () => new Promise(r => setImmediate(r))

function a(id: string, text: string): AssistantMessage {
  return { role: 'assistant', id, ts: 0, content: [{ type: 'text', text }] }
}

describe('<MessageSelector>', () => {
  it('lists assistant messages with numbered previews', () => {
    const msgs = [a('a1', 'first line of reply'), a('a2', 'another reply\nsecond line')]
    const { lastFrame } = render(
      <MessageSelector messages={msgs} onSelect={() => {}} onCancel={() => {}} />,
    )
    const frame = lastFrame() ?? ''
    expect(frame).toContain('1. first line of reply')
    expect(frame).toContain('2. another reply')
  })

  it('Enter invokes onSelect with the highlighted message id', async () => {
    const onSelect = vi.fn()
    const { stdin } = render(
      <MessageSelector
        messages={[a('a1', 'one'), a('a2', 'two')]}
        onSelect={onSelect}
        onCancel={() => {}}
      />,
    )
    stdin.write('\r')
    await flush()
    expect(onSelect).toHaveBeenCalledWith('a1')
  })

  it('Down arrow then Enter picks the second message', async () => {
    const onSelect = vi.fn()
    const { stdin } = render(
      <MessageSelector
        messages={[a('a1', 'one'), a('a2', 'two')]}
        onSelect={onSelect}
        onCancel={() => {}}
      />,
    )
    stdin.write('\u001B[B') // down arrow
    await flush()
    await flush()
    stdin.write('\r')
    await flush()
    await flush()
    // cursor should have advanced; first-call arg is 'a2'
    expect(onSelect).toHaveBeenCalled()
    expect(onSelect.mock.calls[0]?.[0]).toBe('a2')
  })

  it('Esc invokes onCancel', async () => {
    const onCancel = vi.fn()
    const { stdin } = render(
      <MessageSelector
        messages={[a('a1', 'one')]}
        onSelect={() => {}}
        onCancel={onCancel}
      />,
    )
    stdin.write('\u001B')
    await flush()
    expect(onCancel).toHaveBeenCalled()
  })

  it('renders a friendly message when no assistant messages', () => {
    const { lastFrame } = render(
      <MessageSelector messages={[]} onSelect={() => {}} onCancel={() => {}} />,
    )
    expect(lastFrame() ?? '').toContain('No assistant messages')
  })
})
