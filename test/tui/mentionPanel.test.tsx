// test/tui/mentionPanel.test.tsx
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import { MentionPanel } from '../../src/tui/PromptInput/MentionPanel'

describe('MentionPanel', () => {
  it('renders matches with cursor highlighted', () => {
    const { lastFrame } = render(
      <MentionPanel
        query="src"
        matches={['src/index.ts', 'src/App.tsx', 'src/theme.ts']}
        cursor={1}
        onSelect={() => {}}
        onCancel={() => {}}
      />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('src/App.tsx')
    expect(f).toContain('›')
  })

  it('shows no-matches notice when matches is empty', () => {
    const { lastFrame } = render(
      <MentionPanel
        query="xyz"
        matches={[]}
        cursor={0}
        onSelect={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(lastFrame()).toContain('no matches')
  })
})
