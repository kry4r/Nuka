/**
 * Inlines non-file prompt references into the submitted text.
 *
 * The TUI accumulates accepted mention tokens (diff / staged / git / commit
 * / url / image) via `PromptInput.onAttachReference`. At submit time the
 * App calls this helper, which builds a synthetic `PromptDraft` from the
 * collected tokens, runs `resolvePromptDraft`, and returns the final
 * inlined text (resolved blocks + the user's raw prompt).
 *
 * The function is pure modulo the injected `PromptResolverDeps` — there is
 * no module-scoped fs / fetch / git access, so callers can stub each
 * capability in tests. File-kind tokens are intentionally not handled
 * here: `App.tsx` keeps the existing `pendingAttachments` path (file
 * contents read with `node:fs` + inlined as `[file: …]` blocks) to avoid
 * regressing the established mention contract.
 *
 * Image-kind tokens are also deferred: image content lives on a separate
 * provider transport (base64 + mime), not the text channel. We emit a
 * single placeholder line so the agent still sees the user's intent, and
 * leave a TODO for a future iteration that wires `ResolvedImageArtifact`
 * into the provider message payload.
 */

import { resolvePromptDraft, type PromptResolverDeps } from './resolver'
import type {
  PromptDraft,
  PromptDraftElement,
  PromptReferenceToken,
  ResolvedPromptArtifacts,
} from './types'

export type InlineReferencesInput = {
  raw: string
  tokens: readonly PromptReferenceToken[]
  deps: PromptResolverDeps
}

export type InlineReferencesResult = {
  /** Final text to submit — resolved artifact blocks + the user's raw prompt. */
  text: string
  /** Pass-through warnings / errors so callers may surface them later. */
  artifacts: ResolvedPromptArtifacts
}

function buildSyntheticDraft(
  tokens: readonly PromptReferenceToken[],
): PromptDraft {
  const tokensById: Record<string, PromptReferenceToken> = {}
  const elements: PromptDraftElement[] = []

  for (const token of tokens) {
    if (tokensById[token.id]) {
      // Duplicate ids — keep the first occurrence (insertion order is the
      // accept order from the TUI). resolvePromptDraft iterates by
      // byteRange so we never want two elements pointing at the same span.
      continue
    }
    tokensById[token.id] = token
    elements.push({
      id: token.id,
      kind: token.kind === 'image' ? 'image' : 'mention',
      tokenId: token.id,
      // The synthetic draft text is empty, so every element has a zero-width
      // range. resolvePromptDraft only uses byteRange for sort order, which
      // we control via insertion order anyway.
      byteRange: { start: 0, end: 0 },
      placeholderLabel: '',
    })
  }

  return {
    text: '',
    elements,
    tokensById,
    assetsById: {},
    cursor: { offset: 0 },
  }
}

function blockForTextArtifact(label: string, content: string): string {
  return `[${label}]\n${content}`
}

export async function inlineReferencesIntoText(
  input: InlineReferencesInput,
): Promise<InlineReferencesResult> {
  if (input.tokens.length === 0) {
    return {
      text: input.raw,
      artifacts: {
        promptText: input.raw,
        textArtifacts: [],
        imageArtifacts: [],
        warnings: [],
        errors: [],
      },
    }
  }

  const draft = buildSyntheticDraft(input.tokens)
  const artifacts = await resolvePromptDraft(draft, input.deps)

  const blocks: string[] = []
  for (const ta of artifacts.textArtifacts) {
    blocks.push(blockForTextArtifact(ta.label, ta.content))
  }
  // Image follow-up: provider transport is not yet wired through
  // `runAgent({ text })`. Surface a stub line so the agent at least sees
  // the mention; the real fix lands when the provider message payload
  // grows an image channel (see docs/plans for the follow-up entry).
  for (const ia of artifacts.imageArtifacts) {
    const label = ia.localPath ?? ia.remoteUrl ?? ia.providerFileId ?? 'attached'
    blocks.push(`[image: ${label}] (resolution deferred)`)
  }
  // Errors are inlined as visible markers so the user sees the failure
  // rather than having a silently-dropped reference.
  for (const err of artifacts.errors) {
    blocks.push(`[reference error: ${err.message}]`)
  }

  const finalText =
    blocks.length === 0 ? input.raw : `${blocks.join('\n\n')}\n\n${input.raw}`

  return { text: finalText, artifacts }
}
