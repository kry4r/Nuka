// test/tui/sessionPicker.test.tsx
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import { SessionPicker } from '../../src/tui/dialogs/SessionPicker'
import type { SessionMeta } from '../../src/core/session/store'

const flush = () => new Promise(r => setImmediate(r))

const metas: SessionMeta[] = [
  {
    id: 'AAABBBCC0011223344556677',
    parentId: undefined,
    providerId: 'p1',
    model: 'claude-sonnet-4-6',
    messageCount: 5,
    totalUsage: { inputTokens: 100, outputTokens: 50 },
    mode: 'normal',
    createdAt: 1700000000000,
    updatedAt: 1700000100000,
  },
  {
    id: 'ZZZYYYXX0011223344556677',
    parentId: undefined,
    providerId: 'p2',
    model: 'gpt-5',
    messageCount: 3,
    totalUsage: { inputTokens: 60, outputTokens: 30 },
    mode: 'normal',
    createdAt: 1700001000000,
    updatedAt: 1700001100000,
  },
]

describe('SessionPicker', () => {
  it('renders session list', () => {
    const { lastFrame } = render(
      <SessionPicker sessions={metas} onSelect={() => {}} onCancel={() => {}} />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('AAABBBC')
    expect(f).toContain('claude-sonnet-4-6')
    expect(f).toContain('msgs=5')
    expect(f).toContain('ZZZYYYXX')
    expect(f).toContain('gpt-5')
  })

  it('enter fires onSelect with the session id', async () => {
    const onSelect = vi.fn()
    const { stdin } = render(
      <SessionPicker sessions={metas} onSelect={onSelect} onCancel={() => {}} />,
    )
    stdin.write('\r')
    await flush()
    expect(onSelect).toHaveBeenCalledWith(metas[0]!.id)
  })

  it('renders empty state when sessions list is empty', () => {
    const { lastFrame } = render(
      <SessionPicker sessions={[]} onSelect={() => {}} onCancel={() => {}} />,
    )
    expect(lastFrame()).toContain('No past sessions.')
  })
})
