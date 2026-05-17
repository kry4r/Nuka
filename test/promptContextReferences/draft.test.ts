import { describe, expect, test } from 'vitest'

import {
  createPromptDraft,
  insertPromptElement,
  removePromptElement,
  syncPromptDraftText,
} from '../../src/promptContextReferences/draft'
import { buildPromptPlaceholderLabel } from '../../src/promptContextReferences/display'
import type { PromptReferenceToken } from '../../src/promptContextReferences/types'

const fileToken: PromptReferenceToken = {
  id: 'file-src-hooks-useTypeahead',
  kind: 'file',
  display: 'src/hooks/useTypeahead.tsx',
  target: {
    kind: 'file',
    path: 'src/hooks/useTypeahead.tsx',
  },
  resolvePolicy: 'live',
  status: 'valid',
  metadata: {},
}

const readmeToken: PromptReferenceToken = {
  id: 'file-readme',
  kind: 'file',
  display: 'README.md',
  target: {
    kind: 'file',
    path: 'README.md',
  },
  resolvePolicy: 'live',
  status: 'valid',
  metadata: {},
}

describe('prompt draft', () => {
  test('inserts and removes a mention element with stable exclusive byte ranges', () => {
    const draft = createPromptDraft('Review ')
    const placeholderLabel = '@src/hooks/useTypeahead.tsx'

    const inserted = insertPromptElement(draft, {
      elementId: fileToken.id,
      token: fileToken,
      kind: 'mention',
      placeholderLabel,
      cursorOffset: draft.cursor.offset,
    })

    expect(inserted.text).toBe('Review @src/hooks/useTypeahead.tsx')
    expect(inserted.elements).toEqual([
      {
        id: 'file-src-hooks-useTypeahead',
        kind: 'mention',
        tokenId: 'file-src-hooks-useTypeahead',
        byteRange: {
          start: 7,
          end: 7 + placeholderLabel.length,
        },
        placeholderLabel,
      },
    ])
    expect(inserted.cursor).toEqual({
      offset: inserted.text.length,
      selectedElementId: 'file-src-hooks-useTypeahead',
    })

    const removed = removePromptElement(inserted, 'file-src-hooks-useTypeahead')
    expect(removed.text).toBe('Review ')
    expect(removed.elements).toEqual([])
    expect(removed.cursor.offset).toBe(7)
  })

  test('replaces overlapping prompt elements without leaving stale ranges behind', () => {
    const inserted = insertPromptElement(createPromptDraft('Review '), {
      elementId: fileToken.id,
      token: fileToken,
      kind: 'mention',
      placeholderLabel: '@src/hooks/useTypeahead.tsx',
      cursorOffset: 7,
    })
    const replacement = insertPromptElement(inserted, {
      elementId: readmeToken.id,
      token: readmeToken,
      kind: 'mention',
      placeholderLabel: '@README.md',
      replaceRange: inserted.elements[0]!.byteRange,
    })

    expect(replacement.text).toBe('Review @README.md')
    expect(replacement.elements).toEqual([
      {
        id: 'file-readme',
        kind: 'mention',
        tokenId: 'file-readme',
        byteRange: {
          start: 7,
          end: 17,
        },
        placeholderLabel: '@README.md',
      },
    ])
    expect(replacement.tokensById).toEqual({
      'file-readme': readmeToken,
    })
  })

  test('uses history image placeholder labels for clipboard-backed image tokens', () => {
    expect(
      buildPromptPlaceholderLabel({
        id: 'image-2',
        kind: 'image',
        display: 'diagram.png',
        target: {
          kind: 'image',
          sourceKind: 'clipboard_asset',
          pastedContentId: 2,
          mimeType: 'image/png',
        },
        resolvePolicy: 'snapshot',
        status: 'valid',
        metadata: {},
      }),
    ).toBe('[Image #2]')

    expect(
      buildPromptPlaceholderLabel({
        id: 'file-spaced-notes',
        kind: 'file',
        display: 'notes/my file.md',
        target: {
          kind: 'file',
          path: 'notes/my file.md',
        },
        resolvePolicy: 'live',
        status: 'valid',
        metadata: {},
      }),
    ).toBe('@"notes/my file.md"')
  })

  test('shifts existing mention ranges when plain text is inserted before a chip', () => {
    const inserted = insertPromptElement(createPromptDraft('Review '), {
      elementId: readmeToken.id,
      token: readmeToken,
      kind: 'mention',
      placeholderLabel: '@README.md',
      cursorOffset: 7,
    })

    const shifted = syncPromptDraftText(
      inserted,
      'Please Review @README.md',
      23,
    )

    expect(shifted.text).toBe('Please Review @README.md')
    expect(shifted.elements).toEqual([
      {
        id: 'file-readme',
        kind: 'mention',
        tokenId: 'file-readme',
        byteRange: {
          start: 14,
          end: 24,
        },
        placeholderLabel: '@README.md',
      },
    ])
    expect(shifted.cursor.offset).toBe(23)
  })

  test('keeps both image chips when inserts are applied sequentially from updated draft state', () => {
    const firstImage = {
      id: 1,
      type: 'image' as const,
      content: 'aW1hZ2UtMQ==',
      mediaType: 'image/png',
      filename: 'first.png',
    }
    const secondImage = {
      id: 2,
      type: 'image' as const,
      content: 'aW1hZ2UtMg==',
      mediaType: 'image/png',
      filename: 'second.png',
    }
    const withFirst = insertPromptElement(createPromptDraft(''), {
      elementId: 'image-1',
      token: {
        id: 'image-1',
        kind: 'image',
        display: '[Image #1]',
        target: {
          kind: 'image',
          sourceKind: 'clipboard_asset',
          pastedContentId: 1,
          mimeType: 'image/png',
        },
        resolvePolicy: 'snapshot',
        status: 'valid',
        metadata: {},
      },
      kind: 'image',
      placeholderLabel: '[Image #1]',
      cursorOffset: 0,
      asset: firstImage,
    })
    const withSecond = insertPromptElement(withFirst, {
      elementId: 'image-2',
      token: {
        id: 'image-2',
        kind: 'image',
        display: '[Image #2]',
        target: {
          kind: 'image',
          sourceKind: 'clipboard_asset',
          pastedContentId: 2,
          mimeType: 'image/png',
        },
        resolvePolicy: 'snapshot',
        status: 'valid',
        metadata: {},
      },
      kind: 'image',
      placeholderLabel: ' [Image #2]',
      cursorOffset: withFirst.cursor.offset,
      asset: secondImage,
    })

    expect(withSecond.text).toBe('[Image #1] [Image #2]')
    expect(withSecond.elements).toEqual([
      {
        id: 'image-1',
        kind: 'image',
        tokenId: 'image-1',
        byteRange: {
          start: 0,
          end: 10,
        },
        placeholderLabel: '[Image #1]',
      },
      {
        id: 'image-2',
        kind: 'image',
        tokenId: 'image-2',
        byteRange: {
          start: 10,
          end: 21,
        },
        placeholderLabel: ' [Image #2]',
      },
    ])
    expect(Object.keys(withSecond.assetsById)).toEqual(['image-1', 'image-2'])
  })
})

describe('prompt draft — commit kind', () => {
  test('inserts and removes a commit mention element', () => {
    const commitToken: PromptReferenceToken = {
      id: 'commit-a1b2c3d',
      kind: 'commit',
      display: 'a1b2c3d',
      target: { kind: 'commit', hash: 'a1b2c3d', subject: 'feat: add foo' },
      resolvePolicy: 'live',
      status: 'valid',
      metadata: { source: 'palette' },
    }
    const draft = createPromptDraft('Review ')
    const placeholderLabel = '@commit:a1b2c3d'
    const inserted = insertPromptElement(draft, {
      elementId: commitToken.id,
      token: commitToken,
      kind: 'mention',
      placeholderLabel,
      cursorOffset: draft.cursor.offset,
    })
    expect(inserted.text).toBe('Review @commit:a1b2c3d')
    expect(inserted.elements).toEqual([
      {
        id: 'commit-a1b2c3d',
        kind: 'mention',
        tokenId: 'commit-a1b2c3d',
        byteRange: {
          start: 7,
          end: 7 + placeholderLabel.length,
        },
        placeholderLabel,
      },
    ])
    expect(inserted.tokensById['commit-a1b2c3d']).toEqual(commitToken)

    const removed = removePromptElement(inserted, 'commit-a1b2c3d')
    expect(removed.text).toBe('Review ')
    expect(removed.elements).toEqual([])
    expect(removed.tokensById).toEqual({})
  })
})
