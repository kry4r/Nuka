// test/tui/promptMentions/MentionPalette.test.tsx
import React from 'react'
import { describe, expect, it } from 'vitest'
import { render } from 'ink-testing-library'

import { MentionPalette } from '../../../src/tui/promptMentions/MentionPalette'
import type { PromptMentionOption } from '../../../src/promptContextReferences/palette'

function fileOption(label: string, id = label): PromptMentionOption {
  return {
    id: `file-${id}`,
    type: 'file',
    label,
    exactMatch: false,
    prefixMatch: true,
    fuzzyScore: 1,
    recentScore: 0,
  }
}

describe('MentionPalette', () => {
  it('renders all known type names in the left pane', () => {
    const { lastFrame } = render(
      <MentionPalette
        activeType="file"
        focusedPane="types"
        options={[]}
        selectedIndex={0}
      />,
    )
    const frame = lastFrame() ?? ''
    expect(frame).toContain('file')
    expect(frame).toContain('folder')
    expect(frame).toContain('diff')
    expect(frame).toContain('staged')
    expect(frame).toContain('commit')
    expect(frame).toContain('git')
    expect(frame).toContain('url')
    expect(frame).toContain('image')
  })

  it('marks the active type with a leading marker', () => {
    const { lastFrame } = render(
      <MentionPalette
        activeType="commit"
        focusedPane="types"
        options={[]}
        selectedIndex={0}
      />,
    )
    const frame = lastFrame() ?? ''
    // The active row carries the › marker; non-active rows do not.
    expect(frame).toMatch(/›\s*commit/)
  })

  it('shows "No results" when options list is empty', () => {
    const { lastFrame } = render(
      <MentionPalette
        activeType="file"
        focusedPane="results"
        options={[]}
        selectedIndex={0}
      />,
    )
    expect(lastFrame()).toContain('No results')
  })

  it('renders option labels and marks the selected one', () => {
    const options = [
      fileOption('src/a.ts'),
      fileOption('src/b.ts'),
      fileOption('src/c.ts'),
    ]
    const { lastFrame } = render(
      <MentionPalette
        activeType="file"
        focusedPane="results"
        options={options}
        selectedIndex={1}
      />,
    )
    const frame = lastFrame() ?? ''
    expect(frame).toContain('src/a.ts')
    expect(frame).toContain('src/b.ts')
    expect(frame).toContain('src/c.ts')
    // Selected row owns the › marker (and is in the results pane).
    expect(frame).toMatch(/›\s*src\/b\.ts/)
  })

  it('renders the optional preview line when supplied', () => {
    const { lastFrame } = render(
      <MentionPalette
        activeType="file"
        focusedPane="results"
        options={[fileOption('src/a.ts')]}
        selectedIndex={0}
        preview="file src/a.ts"
      />,
    )
    expect(lastFrame()).toContain('file src/a.ts')
  })

  it('caps visible results to maxResults', () => {
    const options = Array.from({ length: 25 }, (_, i) =>
      fileOption(`row-${i}.ts`, String(i)),
    )
    const { lastFrame } = render(
      <MentionPalette
        activeType="file"
        focusedPane="results"
        options={options}
        selectedIndex={0}
        maxResults={3}
      />,
    )
    const frame = lastFrame() ?? ''
    expect(frame).toContain('row-0.ts')
    expect(frame).toContain('row-2.ts')
    expect(frame).not.toContain('row-3.ts')
  })

  it('does not render the › marker on the results pane when types pane is focused', () => {
    const { lastFrame } = render(
      <MentionPalette
        activeType="file"
        focusedPane="types"
        options={[fileOption('src/a.ts')]}
        selectedIndex={0}
      />,
    )
    const frame = lastFrame() ?? ''
    expect(frame).toContain('src/a.ts')
    // The selected option should not get a › when focus is on types.
    expect(frame).not.toMatch(/›\s*src\/a\.ts/)
  })
})
