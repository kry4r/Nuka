import { describe, expect, test } from 'vitest'

import {
  detectPromptMentionQuery,
  findPromptMentionReplacementEnd,
  rankPromptMentionOptions,
  type PromptMentionOption,
  PROMPT_MENTION_TYPES,
} from '../../src/promptContextReferences/palette'

describe('prompt mention palette', () => {
  test('opens the type rail when only @ is typed', () => {
    expect(detectPromptMentionQuery('Review @', 8)).toEqual({
      triggerStart: 7,
      triggerText: '@',
      activeType: 'file',
      query: '',
      focusedPane: 'types',
    })
  })

  test('routes @git:3 to git results mode', () => {
    expect(detectPromptMentionQuery('Review @git:3', 13)).toEqual({
      triggerStart: 7,
      triggerText: '@git:3',
      activeType: 'git',
      query: '3',
      focusedPane: 'results',
    })
  })

  test('keeps reserved aliases exact so ordinary file names still search', () => {
    expect(detectPromptMentionQuery('Review @different', 17)).toEqual({
      triggerStart: 7,
      triggerText: '@different',
      activeType: 'file',
      query: 'different',
      focusedPane: 'results',
    })
    expect(detectPromptMentionQuery('Review @stagediary', 18)).toEqual({
      triggerStart: 7,
      triggerText: '@stagediary',
      activeType: 'file',
      query: 'stagediary',
      focusedPane: 'results',
    })
  })

  test('keeps quoted file queries open while typing spaces', () => {
    expect(detectPromptMentionQuery('Review @"my notes', 17)).toEqual({
      triggerStart: 7,
      triggerText: '@"my notes',
      activeType: 'file',
      query: 'my notes',
      focusedPane: 'results',
    })
  })

  test('replaces the full token when the cursor is in the middle of a mention', () => {
    const quotedText = 'Review @"my notes.txt"'
    expect(
      findPromptMentionReplacementEnd(
        quotedText,
        quotedText.indexOf('txt'),
      ),
    ).toBe(quotedText.length)

    const plainText = 'Review @readme.md'
    expect(
      findPromptMentionReplacementEnd(
        plainText,
        plainText.indexOf('dme'),
      ),
    ).toBe(plainText.length)
  })

  test('keeps deterministic ordering for ties', () => {
    const ranked = rankPromptMentionOptions('file', [
      {
        id: 'file-zed',
        type: 'file',
        label: 'zed.ts',
        exactMatch: false,
        prefixMatch: false,
        fuzzyScore: 12,
        recentScore: 0,
      },
      {
        id: 'file-alpha',
        type: 'file',
        label: 'alpha.ts',
        exactMatch: false,
        prefixMatch: false,
        fuzzyScore: 12,
        recentScore: 0,
      },
      {
        id: 'diff-current',
        type: 'diff',
        label: 'Current diff',
        exactMatch: true,
        prefixMatch: true,
        fuzzyScore: 1,
        recentScore: 0,
      },
    ] satisfies PromptMentionOption[])

    expect(ranked.map(option => option.id)).toEqual([
      'file-alpha',
      'file-zed',
      'diff-current',
    ])
  })
})

describe('detectPromptMentionQuery — @commit', () => {
  test('bare @commit: opens commit pane with empty query', () => {
    const result = detectPromptMentionQuery('Review @commit:', 15)
    expect(result).toEqual({
      triggerStart: 7,
      triggerText: '@commit:',
      activeType: 'commit',
      query: '',
      focusedPane: 'results',
    })
  })

  test('@commit:<hash> extracts the hash as query', () => {
    const result = detectPromptMentionQuery('See @commit:a1b2c3d', 19)
    expect(result).toMatchObject({
      activeType: 'commit',
      query: 'a1b2c3d',
      focusedPane: 'results',
    })
  })

  test('@git:A..B is still recognised as git (regression)', () => {
    const result = detectPromptMentionQuery('diff @git:main..feature', 23)
    expect(result).toMatchObject({
      activeType: 'git',
      query: 'main..feature',
    })
  })
})

describe('PROMPT_MENTION_TYPES', () => {
  test('includes commit', () => {
    expect(PROMPT_MENTION_TYPES).toContain('commit')
  })

  test('keeps git alongside commit for range support', () => {
    expect(PROMPT_MENTION_TYPES).toContain('git')
  })
})
