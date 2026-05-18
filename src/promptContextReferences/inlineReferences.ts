/**
 * Inlines non-file prompt references into the submitted text and lifts
 * image references onto a structured side channel.
 *
 * The TUI accumulates accepted mention tokens (diff / staged / git /
 * commit / url / image) via `PromptInput.onAttachReference`. At submit
 * time the App calls this helper, which builds a synthetic `PromptDraft`
 * from the collected tokens, runs `resolvePromptDraft`, and returns:
 *
 *   - `text`     — resolved text-artifact blocks + the user's raw prompt
 *   - `images`   — structured `ImageContentBlock[]` ready to feed
 *                   `makeUserMessage({ text, images })`
 *   - `artifacts`— pass-through warnings/errors for UI surfacing
 *
 * The function is pure modulo the injected `PromptResolverDeps` — no
 * module-scoped fs / fetch / git access, so callers can stub each
 * capability in tests. File-kind tokens are intentionally not handled
 * here: `App.tsx` keeps the existing `pendingAttachments` path (file
 * contents read with `node:fs` + inlined as `[file: …]` blocks) to avoid
 * regressing the established mention contract.
 *
 * Image transport rules:
 *   - `clipboard_asset` + `local_path`: base64 with size cap. Bytes >
 *     `getImageMaxBytes()` (default 5 MiB, env-override
 *     `NUKA_PROMPT_IMAGE_MAX_BYTES`) are rejected — the image is dropped
 *     and a `[image rejected: …]` marker lands in the text channel +
 *     `artifacts.errors`.
 *   - `remote_url`: URL passthrough. OpenAI consumes natively; the
 *     Anthropic provider rewrites the block to a text marker because
 *     Anthropic does not accept remote URLs for inline images.
 *   - `provider_file_id`: out of scope for this plan; a text marker is
 *     emitted so the agent still sees the user's intent.
 *   - missing/unreadable file: resolver throws → captured as a normal
 *     `artifacts.errors` entry and inlined as a `[reference error: …]`
 *     marker, just like any other resolver failure.
 */

import { resolvePromptDraft, type PromptResolverDeps } from './resolver'
import { base64Bytes, getImageMaxBytes } from './imageBudget'
import type {
  PromptDraft,
  PromptDraftElement,
  PromptReferenceToken,
  ResolvedImageArtifact,
  ResolvedPromptArtifacts,
} from './types'
import type { ImageContentBlock } from '../core/message/types'

export type InlineReferencesInput = {
  raw: string
  tokens: readonly PromptReferenceToken[]
  deps: PromptResolverDeps
}

export type InlineReferencesResult = {
  /** Final text to submit — resolved artifact blocks + the user's raw prompt. */
  text: string
  /** Structured image attachments to forward to the provider message. */
  images: ImageContentBlock[]
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

function imageDisplayPath(ia: ResolvedImageArtifact): string {
  return ia.localPath ?? ia.remoteUrl ?? ia.providerFileId ?? 'attached'
}

/**
 * Convert a resolved image artifact to an `ImageContentBlock`, applying
 * the byte-size cap. Returns `null` and records markers/errors when the
 * artifact cannot be attached.
 *
 * Side-effects (intentional): on rejection, appends to `errors` and
 * `textMarkers` so the caller can fold both into the final text + the
 * existing error-marker pass without re-walking the artifact list.
 */
function imageArtifactToBlock(
  ia: ResolvedImageArtifact,
  maxBytes: number,
  errors: ResolvedPromptArtifacts['errors'],
  textMarkers: string[],
): ImageContentBlock | null {
  if (ia.sourceKind === 'local_path' || ia.sourceKind === 'clipboard_asset') {
    if (ia.dataBase64 === undefined || ia.mimeType === undefined) {
      errors.push({
        tokenId: ia.originTokenId,
        message: `image missing data for ${imageDisplayPath(ia)}`,
      })
      textMarkers.push(`[image: ${imageDisplayPath(ia)} (no data)]`)
      return null
    }
    const decodedBytes = base64Bytes(ia.dataBase64)
    if (decodedBytes > maxBytes) {
      const msg = `${imageDisplayPath(ia)} exceeds ${maxBytes} bytes (image ${decodedBytes} bytes)`
      errors.push({
        tokenId: ia.originTokenId,
        message: `image rejected: ${msg}`,
      })
      textMarkers.push(`[image rejected: ${msg}]`)
      return null
    }
    return { type: 'image', mediaType: ia.mimeType, dataBase64: ia.dataBase64 }
  }
  if (ia.sourceKind === 'remote_url') {
    if (ia.remoteUrl === undefined || ia.mimeType === undefined) {
      textMarkers.push(`[image: ${imageDisplayPath(ia)} (incomplete remote_url)]`)
      return null
    }
    return { type: 'image', mediaType: ia.mimeType, url: ia.remoteUrl }
  }
  // provider_file_id is out of scope: keep a text marker so the model sees the intent.
  textMarkers.push(`[image: ${imageDisplayPath(ia)} (provider_file_id transport not wired)]`)
  return null
}

export async function inlineReferencesIntoText(
  input: InlineReferencesInput,
): Promise<InlineReferencesResult> {
  if (input.tokens.length === 0) {
    return {
      text: input.raw,
      images: [],
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
  const maxBytes = getImageMaxBytes()

  const blocks: string[] = []
  for (const ta of artifacts.textArtifacts) {
    blocks.push(blockForTextArtifact(ta.label, ta.content))
  }

  const images: ImageContentBlock[] = []
  const textMarkers: string[] = []
  for (const ia of artifacts.imageArtifacts) {
    const blk = imageArtifactToBlock(ia, maxBytes, artifacts.errors, textMarkers)
    if (blk) images.push(blk)
  }
  blocks.push(...textMarkers)

  // Surface errors raised by the resolver itself (e.g. missing file) as
  // visible markers, in addition to size-rejection markers above. Use the
  // size-rejection's message-include check to avoid double-printing the
  // `[image rejected: …]` line via the generic `[reference error: …]` path.
  for (const err of artifacts.errors) {
    if (textMarkers.some(m => m.includes(err.message))) continue
    if (err.message.startsWith('image rejected:')) continue
    blocks.push(`[reference error: ${err.message}]`)
  }

  const finalText =
    blocks.length === 0 ? input.raw : `${blocks.join('\n\n')}\n\n${input.raw}`

  return { text: finalText, images, artifacts }
}
