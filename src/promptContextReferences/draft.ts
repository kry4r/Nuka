/**
 * Pure draft state for the prompt-mention module.
 *
 * Operates on a `PromptDraft` value: text + an array of elements (chips)
 * with byte ranges + sidecar token/asset registries. All mutators are
 * pure functions that return a new `PromptDraft` — no IO, no React,
 * unit-testable in isolation.
 */

import type {
  PastedContent,
  PromptDraft,
  PromptDraftElement,
  PromptReferenceToken,
} from './types'

type InsertPromptElementInput = {
  elementId: string
  token: PromptReferenceToken
  kind: PromptDraftElement['kind']
  placeholderLabel: string
  cursorOffset?: number
  replaceRange?: {
    start: number
    end: number
  }
  asset?: PastedContent
}

function rangesOverlap(
  left: { start: number; end: number },
  right: { start: number; end: number },
): boolean {
  return left.start < right.end && right.start < left.end
}

function shiftElements(
  elements: PromptDraftElement[],
  pivot: number,
  delta: number,
): PromptDraftElement[] {
  return elements.map(element => ({
    ...element,
    byteRange: {
      start:
        element.byteRange.start >= pivot
          ? element.byteRange.start + delta
          : element.byteRange.start,
      end:
        element.byteRange.start >= pivot
          ? element.byteRange.end + delta
          : element.byteRange.end,
    },
  }))
}

export function createPromptDraft(text = ''): PromptDraft {
  return {
    text,
    elements: [],
    tokensById: {},
    assetsById: {},
    cursor: {
      offset: text.length,
    },
  }
}

function retainReferencedState(
  draft: PromptDraft,
  elements: PromptDraftElement[],
): Pick<PromptDraft, 'tokensById' | 'assetsById'> {
  const referencedTokenIds = new Set(elements.map(element => element.tokenId))

  return {
    tokensById: Object.fromEntries(
      Object.entries(draft.tokensById).filter(([tokenId]) =>
        referencedTokenIds.has(tokenId),
      ),
    ) as PromptDraft['tokensById'],
    assetsById: Object.fromEntries(
      Object.entries(draft.assetsById).filter(([tokenId]) =>
        referencedTokenIds.has(tokenId),
      ),
    ) as PromptDraft['assetsById'],
  }
}

export function syncPromptDraftText(
  draft: PromptDraft,
  nextText: string,
  cursorOffset = Math.min(draft.cursor.offset, nextText.length),
): PromptDraft {
  if (draft.text === nextText) {
    return {
      ...draft,
      cursor: {
        ...draft.cursor,
        offset: cursorOffset,
      },
    }
  }

  let prefixLength = 0
  while (
    prefixLength < draft.text.length &&
    prefixLength < nextText.length &&
    draft.text[prefixLength] === nextText[prefixLength]
  ) {
    prefixLength++
  }

  let previousSuffixStart = draft.text.length
  let nextSuffixStart = nextText.length
  while (
    previousSuffixStart > prefixLength &&
    nextSuffixStart > prefixLength &&
    draft.text[previousSuffixStart - 1] === nextText[nextSuffixStart - 1]
  ) {
    previousSuffixStart--
    nextSuffixStart--
  }

  const replacementLength = previousSuffixStart - prefixLength
  const insertedText = nextText.slice(prefixLength, nextSuffixStart)
  const delta = insertedText.length - replacementLength
  const replaceRange = {
    start: prefixLength,
    end: previousSuffixStart,
  }
  const shiftedElements = shiftElements(
    draft.elements.filter(
      element => !rangesOverlap(element.byteRange, replaceRange),
    ),
    replaceRange.end,
    delta,
  )
  const retainedState = retainReferencedState(draft, shiftedElements)

  return {
    text: nextText,
    elements: shiftedElements,
    ...retainedState,
    cursor: {
      offset: cursorOffset,
    },
  }
}

export function insertPromptElement(
  draft: PromptDraft,
  input: InsertPromptElementInput,
): PromptDraft {
  const start = input.replaceRange?.start ?? input.cursorOffset ?? draft.cursor.offset
  const end = input.replaceRange?.end ?? start
  const replacementLength = end - start
  const delta = input.placeholderLabel.length - replacementLength
  const replaceRange = { start, end }
  const survivingElements = draft.elements.filter(
    element =>
      element.id !== input.elementId &&
      !rangesOverlap(element.byteRange, replaceRange),
  )
  const shiftedElements = shiftElements(
    survivingElements,
    end,
    delta,
  )

  const element: PromptDraftElement = {
    id: input.elementId,
    kind: input.kind,
    tokenId: input.token.id,
    byteRange: {
      start,
      end: start + input.placeholderLabel.length,
    },
    placeholderLabel: input.placeholderLabel,
  }
  const retainedState = retainReferencedState(draft, shiftedElements)

  return {
    text: draft.text.slice(0, start) + input.placeholderLabel + draft.text.slice(end),
    elements: [...shiftedElements, element].sort(
      (left, right) => left.byteRange.start - right.byteRange.start,
    ),
    tokensById: {
      ...retainedState.tokensById,
      [input.token.id]: input.token,
    },
    assetsById: input.asset
      ? {
          ...retainedState.assetsById,
          [input.token.id]: input.asset,
        }
      : retainedState.assetsById,
    cursor: {
      offset: start + input.placeholderLabel.length,
      selectedElementId: input.elementId,
    },
  }
}

export function removePromptElement(
  draft: PromptDraft,
  elementId: string,
): PromptDraft {
  const element = draft.elements.find(candidate => candidate.id === elementId)
  if (!element) {
    return draft
  }

  const delta = -(element.byteRange.end - element.byteRange.start)
  const remainingElements = shiftElements(
    draft.elements.filter(candidate => candidate.id !== elementId),
    element.byteRange.end,
    delta,
  )

  const nextTokensById = { ...draft.tokensById }
  const nextAssetsById = { ...draft.assetsById }
  delete nextTokensById[element.tokenId]
  delete nextAssetsById[element.tokenId]

  return {
    text:
      draft.text.slice(0, element.byteRange.start) +
      draft.text.slice(element.byteRange.end),
    elements: remainingElements,
    tokensById: nextTokensById,
    assetsById: nextAssetsById,
    cursor: {
      offset: element.byteRange.start,
    },
  }
}

export function serializePromptDraft(draft: PromptDraft): string {
  return draft.text
}
