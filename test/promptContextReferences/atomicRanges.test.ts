import { describe, expect, test } from 'vitest'

import {
  createPromptDraft,
  insertPromptElement,
} from '../../src/promptContextReferences/draft'
import {
  applyAtomicBackspace,
  applyAtomicDelete,
  getAtomicSelectionRange,
  snapAtomicCursorOffset,
} from '../../src/promptContextReferences/atomicRanges'
import type { PromptReferenceToken } from '../../src/promptContextReferences/types'

const fileToken: PromptReferenceToken = {
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

describe('atomic chip ranges', () => {
  test('snaps the cursor to chip boundaries instead of landing inside the chip', () => {
    const draft = insertPromptElement(createPromptDraft('Open '), {
      elementId: fileToken.id,
      token: fileToken,
      kind: 'mention',
      placeholderLabel: '@README.md',
      cursorOffset: 5,
    })

    expect(getAtomicSelectionRange(draft, 7)).toEqual({
      start: 5,
      end: 15,
      elementId: 'file-readme',
    })
    expect(snapAtomicCursorOffset(draft, 7, 'left')).toBe(5)
    expect(snapAtomicCursorOffset(draft, 7, 'right')).toBe(15)
  })

  test('backspace removes the whole chip when the cursor is on the trailing edge', () => {
    const draft = insertPromptElement(createPromptDraft('Open '), {
      elementId: fileToken.id,
      token: fileToken,
      kind: 'mention',
      placeholderLabel: '@README.md',
      cursorOffset: 5,
    })

    const nextDraft = applyAtomicBackspace(draft, 15)
    expect(nextDraft?.text).toBe('Open ')
    expect(nextDraft?.elements).toEqual([])
  })

  test('delete removes the whole chip when the cursor is on the leading edge', () => {
    const draft = insertPromptElement(createPromptDraft('Open '), {
      elementId: fileToken.id,
      token: fileToken,
      kind: 'mention',
      placeholderLabel: '@README.md',
      cursorOffset: 5,
    })

    const nextDraft = applyAtomicDelete(draft, 5)
    expect(nextDraft?.text).toBe('Open ')
    expect(nextDraft?.elements).toEqual([])
  })
})
