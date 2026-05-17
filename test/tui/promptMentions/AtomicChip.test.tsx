// test/tui/promptMentions/AtomicChip.test.tsx
import React from 'react'
import { describe, expect, it } from 'vitest'
import { render } from 'ink-testing-library'

import { AtomicChip } from '../../../src/tui/promptMentions/AtomicChip'
import type { PromptReferenceToken } from '../../../src/promptContextReferences/types'

function fileToken(
  overrides: Partial<PromptReferenceToken> = {},
): PromptReferenceToken {
  return {
    id: 'file-1',
    kind: 'file',
    display: 'src/index.ts',
    target: { kind: 'file', path: 'src/index.ts' },
    resolvePolicy: 'live',
    status: 'valid',
    metadata: {},
    ...overrides,
  }
}

describe('AtomicChip', () => {
  it('renders the canonical placeholder label for a file token', () => {
    const { lastFrame } = render(<AtomicChip token={fileToken()} />)
    expect(lastFrame()).toContain('@src/index.ts')
  })

  it('quotes the label when the display contains whitespace', () => {
    const token = fileToken({ display: 'src/path with space.ts' })
    const { lastFrame } = render(<AtomicChip token={token} />)
    expect(lastFrame()).toContain('@"src/path with space.ts"')
  })

  it('uses the @diff sigil for diff tokens', () => {
    const token = fileToken({
      id: 'diff-current',
      kind: 'diff',
      display: 'diff',
      target: { kind: 'diff' },
    })
    const { lastFrame } = render(<AtomicChip token={token} />)
    expect(lastFrame()).toContain('@diff')
  })

  it('uses the @commit:<hash> form for commit tokens', () => {
    const token = fileToken({
      id: 'commit-abc',
      kind: 'commit',
      display: 'abc1234',
      target: { kind: 'commit', hash: 'abc1234' },
    })
    const { lastFrame } = render(<AtomicChip token={token} />)
    expect(lastFrame()).toContain('@commit:abc1234')
  })

  it('respects an explicit label override', () => {
    const { lastFrame } = render(
      <AtomicChip token={fileToken()} label="custom-label" />,
    )
    expect(lastFrame()).toContain('custom-label')
  })

  it('renders an image token using the [Image #N] form when an id is set', () => {
    const token = fileToken({
      id: 'img-1',
      kind: 'image',
      display: 'pasted.png',
      target: {
        kind: 'image',
        sourceKind: 'clipboard_asset',
        pastedContentId: 7,
      },
    })
    const { lastFrame } = render(<AtomicChip token={token} />)
    expect(lastFrame()).toContain('[Image #7]')
  })

  it('renders without throwing for every chip status', () => {
    const statuses = ['draft', 'valid', 'invalid', 'stale', 'resolving'] as const
    for (const status of statuses) {
      const { lastFrame } = render(
        <AtomicChip token={fileToken({ status })} />,
      )
      expect(lastFrame()).toContain('@src/index.ts')
    }
  })

  it('renders in focused mode (bold/inverse) without crashing', () => {
    const { lastFrame } = render(<AtomicChip token={fileToken()} focused />)
    expect(lastFrame()).toContain('@src/index.ts')
  })
})
