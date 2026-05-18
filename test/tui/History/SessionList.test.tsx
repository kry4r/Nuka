import { describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import React from 'react'
import { SessionList } from '../../../src/tui/History/SessionList'
import type { HistoryListEntry, SessionId } from '../../../src/core/session/history/types'

const e = (over: Partial<HistoryListEntry>): HistoryListEntry => ({
  id: 'abc12345' as SessionId,
  providerId: 'anthropic',
  model: 'claude-sonnet',
  messageCount: 3,
  preview: 'hello',
  createdAt: 0,
  updatedAt: 1_700_000_000_000,
  ...over,
})

describe('<SessionList>', () => {
  it('renders empty state', () => {
    const { lastFrame } = render(
      <SessionList entries={[]} loading={false} onResume={() => {}} onDelete={() => {}} onCancel={() => {}} />,
    )
    expect(lastFrame()).toMatch(/No past sessions/)
  })

  it('renders rows with preview + id prefix', () => {
    const { lastFrame } = render(
      <SessionList
        entries={[e({ preview: 'first prompt' }), e({ id: 'def67890' as SessionId, preview: 'second' })]}
        loading={false}
        onResume={() => {}}
        onDelete={() => {}}
        onCancel={() => {}}
      />,
    )
    const frame = lastFrame() ?? ''
    expect(frame).toMatch(/first prompt/)
    expect(frame).toMatch(/second/)
    expect(frame).toMatch(/abc12345/)
  })

  it('calls onResume with selected id on enter', async () => {
    const onResume = vi.fn()
    const { stdin } = render(
      <SessionList
        entries={[e({ id: 'first000' as SessionId }), e({ id: 'second00' as SessionId })]}
        loading={false}
        onResume={onResume}
        onDelete={() => {}}
        onCancel={() => {}}
      />,
    )
    stdin.write('\r') // enter on row 0
    await new Promise(r => setTimeout(r, 10))
    expect(onResume).toHaveBeenCalledWith('first000')
  })

  it('calls onDelete on "d" key', async () => {
    const onDelete = vi.fn()
    const { stdin } = render(
      <SessionList
        entries={[e({ id: 'xyz' as SessionId })]}
        loading={false}
        onResume={() => {}}
        onDelete={onDelete}
        onCancel={() => {}}
      />,
    )
    stdin.write('d')
    await new Promise(r => setTimeout(r, 10))
    expect(onDelete).toHaveBeenCalledWith('xyz')
  })

  it('renders loading state', () => {
    const { lastFrame } = render(
      <SessionList entries={[]} loading={true} onResume={() => {}} onDelete={() => {}} onCancel={() => {}} />,
    )
    expect(lastFrame()).toMatch(/Loading/)
  })
})
