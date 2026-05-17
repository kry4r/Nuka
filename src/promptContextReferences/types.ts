/**
 * Foundational types for the prompt-mention / @-reference module.
 *
 * Ported from Nuka-Code (iteration 1, foundational layer only). Real resolver
 * implementations, TUI rendering, and integration with the existing prompt
 * input are deferred to subsequent iterations.
 *
 * `PastedContent` is inlined here because Nuka does not (yet) have an
 * equivalent of Nuka-Code's `src/utils/config.ts`. When a config module
 * lands, the type can be moved there and re-exported.
 */

export type ImageDimensions = {
  width: number
  height: number
}

export type PastedContent = {
  id: number
  type: 'text' | 'image'
  content: string
  mediaType?: string
  filename?: string
  dimensions?: ImageDimensions
  sourcePath?: string
}

export type PromptReferenceKind =
  | 'file'
  | 'folder'
  | 'diff'
  | 'staged'
  | 'git'
  | 'commit'
  | 'url'
  | 'image'
  | 'agent'
  | 'teammate'

export type PromptReferenceStatus =
  | 'draft'
  | 'valid'
  | 'invalid'
  | 'stale'
  | 'resolving'

export type PromptReferenceResolvePolicy = 'live' | 'snapshot'

export type PromptImageSourceKind =
  | 'clipboard_asset'
  | 'local_path'
  | 'remote_url'
  | 'provider_file_id'

export type PromptReferenceTarget =
  | { kind: 'file'; path: string; lineStart?: number; lineEnd?: number }
  | { kind: 'folder'; path: string }
  | { kind: 'diff' }
  | { kind: 'staged' }
  | { kind: 'git'; revspec: string }
  | {
      kind: 'commit'
      hash: string
      subject?: string
      author?: string
      relativeDate?: string
    }
  | { kind: 'url'; url: string }
  | {
      kind: 'image'
      sourceKind: PromptImageSourceKind
      pastedContentId?: number
      path?: string
      url?: string
      providerFileId?: string
      mimeType?: string
    }
  | { kind: 'agent'; name: string }
  | { kind: 'teammate'; id: string }

export type PromptReferenceToken = {
  id: string
  kind: PromptReferenceKind
  display: string
  target: PromptReferenceTarget
  resolvePolicy: PromptReferenceResolvePolicy
  status: PromptReferenceStatus
  metadata: Record<string, unknown>
}

export type PromptDraftElement = {
  id: string
  kind: 'mention' | 'image' | 'command' | 'pasted_text'
  tokenId: string
  byteRange: {
    start: number
    end: number
  }
  placeholderLabel: string
}

export type PromptDraftCursorState = {
  offset: number
  selectedElementId?: string
}

export type PromptDraft = {
  text: string
  elements: PromptDraftElement[]
  tokensById: Record<string, PromptReferenceToken>
  assetsById: Record<string, PastedContent>
  cursor: PromptDraftCursorState
}

export type ResolveWarning = {
  tokenId: string
  severity: 'soft' | 'stale'
  message: string
}

export type ResolveError = {
  tokenId: string
  message: string
}

export type ResolvedTextArtifact = {
  originTokenId: string
  label: string
  content: string
  provenance: {
    kind: PromptReferenceKind
    target: string
  }
}

export type ResolvedImageArtifact = {
  originTokenId: string
  sourceKind: PromptImageSourceKind
  mimeType?: string
  dataBase64?: string
  localPath?: string
  remoteUrl?: string
  providerFileId?: string
  detail?: 'auto' | 'low' | 'high' | 'original'
}

export type ResolvedPromptArtifacts = {
  promptText: string
  textArtifacts: ResolvedTextArtifact[]
  imageArtifacts: ResolvedImageArtifact[]
  warnings: ResolveWarning[]
  errors: ResolveError[]
}
