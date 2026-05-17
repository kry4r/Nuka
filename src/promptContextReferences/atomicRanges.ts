/**
 * Atomic-chip cursor navigation helpers.
 *
 * A "chip" is a contiguous placeholder range owned by a single element.
 * These helpers let the input behave like the cursor cannot rest inside
 * a chip — it snaps to a boundary, and backspace/delete on a boundary
 * removes the whole chip in one stroke.
 *
 * Pure functions over `PromptDraft`; no IO.
 */

import { removePromptElement } from './draft'
import type { PromptDraft } from './types'

export type AtomicSelectionRange = {
  start: number
  end: number
  elementId: string
}

export function getAtomicSelectionRange(
  draft: PromptDraft,
  offset: number,
): AtomicSelectionRange | null {
  const element = draft.elements.find(
    candidate =>
      offset > candidate.byteRange.start && offset < candidate.byteRange.end,
  )

  if (!element) {
    return null
  }

  return {
    start: element.byteRange.start,
    end: element.byteRange.end,
    elementId: element.id,
  }
}

export function snapAtomicCursorOffset(
  draft: PromptDraft,
  offset: number,
  direction: 'left' | 'right',
): number {
  const range = getAtomicSelectionRange(draft, offset)
  if (!range) {
    return offset
  }
  return direction === 'left' ? range.start : range.end
}

export function applyAtomicBackspace(
  draft: PromptDraft,
  offset: number,
): PromptDraft | null {
  const element = draft.elements.find(
    candidate =>
      candidate.byteRange.start === offset ||
      candidate.byteRange.end === offset ||
      (offset > candidate.byteRange.start && offset <= candidate.byteRange.end),
  )

  return element ? removePromptElement(draft, element.id) : null
}

export function applyAtomicDelete(
  draft: PromptDraft,
  offset: number,
): PromptDraft | null {
  const element = draft.elements.find(
    candidate =>
      candidate.byteRange.start === offset ||
      (offset >= candidate.byteRange.start && offset < candidate.byteRange.end),
  )

  return element ? removePromptElement(draft, element.id) : null
}
