/**
 * Pure helpers for snapshotting, restoring, and reconciling drafts.
 *
 * Used by callers that need to round-trip a draft through plain text
 * (e.g. command expansion, slash sub-prompts) while preserving the
 * element / token / asset sidecars when possible.
 */

import { createPromptDraft } from './draft'
import type { PromptDraft } from './types'

export type PromptDraftSnapshot = Omit<PromptDraft, 'cursor'>

export function snapshotPromptDraft(draft: PromptDraft): PromptDraftSnapshot {
  return {
    text: draft.text,
    elements: [...draft.elements],
    tokensById: { ...draft.tokensById },
    assetsById: { ...draft.assetsById },
  }
}

export function restorePromptDraft(
  snapshot: PromptDraftSnapshot | undefined,
): PromptDraft {
  if (!snapshot) {
    return createPromptDraft('')
  }

  return {
    text: snapshot.text,
    elements: [...snapshot.elements],
    tokensById: { ...snapshot.tokensById },
    assetsById: { ...snapshot.assetsById },
    cursor: {
      offset: snapshot.text.length,
    },
  }
}

export function reconcilePromptDraftText(
  draft: PromptDraft,
  nextText: string,
): PromptDraft {
  const elements: PromptDraft['elements'] = []
  const survivingTokenIds = new Set<string>()
  let searchStart = 0

  for (const element of draft.elements) {
    const nextIndex = nextText.indexOf(element.placeholderLabel, searchStart)
    if (nextIndex === -1) {
      continue
    }

    elements.push({
      ...element,
      byteRange: {
        start: nextIndex,
        end: nextIndex + element.placeholderLabel.length,
      },
    })
    survivingTokenIds.add(element.tokenId)
    searchStart = nextIndex + element.placeholderLabel.length
  }

  return {
    text: nextText,
    elements,
    tokensById: Object.fromEntries(
      Object.entries(draft.tokensById).filter(([tokenId]) =>
        survivingTokenIds.has(tokenId),
      ),
    ) as PromptDraft['tokensById'],
    assetsById: Object.fromEntries(
      Object.entries(draft.assetsById).filter(([tokenId]) =>
        survivingTokenIds.has(tokenId),
      ),
    ) as PromptDraft['assetsById'],
    cursor: {
      offset: nextText.length,
    },
  }
}

export function mergePromptDraftSnapshots(
  parts: Array<{
    text: string
    snapshot?: PromptDraftSnapshot
  }>,
): PromptDraftSnapshot | undefined {
  const nonEmptyParts = parts.filter(part => part.text.length > 0)
  if (nonEmptyParts.length === 0) {
    return undefined
  }

  let text = ''
  const elements: PromptDraftSnapshot['elements'] = []
  const tokensById: PromptDraftSnapshot['tokensById'] = {}
  const assetsById: PromptDraftSnapshot['assetsById'] = {}
  let hasStructuredState = false

  for (const part of nonEmptyParts) {
    const prefix = text.length > 0 ? '\n' : ''
    const offset = text.length + prefix.length
    text += prefix + part.text

    if (!part.snapshot) {
      continue
    }

    hasStructuredState =
      hasStructuredState ||
      part.snapshot.elements.length > 0 ||
      Object.keys(part.snapshot.tokensById).length > 0 ||
      Object.keys(part.snapshot.assetsById).length > 0

    for (const element of part.snapshot.elements) {
      elements.push({
        ...element,
        byteRange: {
          start: element.byteRange.start + offset,
          end: element.byteRange.end + offset,
        },
      })
    }

    Object.assign(tokensById, part.snapshot.tokensById)
    Object.assign(assetsById, part.snapshot.assetsById)
  }

  if (!hasStructuredState) {
    return undefined
  }

  return {
    text,
    elements,
    tokensById,
    assetsById,
  }
}

export function selectPromptRestoreText(input: {
  valueText: string
  preExpansionText?: string
  snapshot?: PromptDraftSnapshot
}): string {
  return input.snapshot?.text ?? input.preExpansionText ?? input.valueText
}
