/**
 * Display helpers — convert tokens into the inline placeholder labels
 * that appear in the draft text, and into short human-readable previews.
 *
 * Pure functions. The image placeholder format mirrors Nuka-Code's
 * `formatImageRef(id)` helper (`[Image #N]`); when Nuka adds a real
 * history / paste-tracking module, this fallback can be swapped for an
 * import without changing the public surface.
 */

import type { PromptReferenceToken } from './types'

function formatImageRef(pastedContentId: number): string {
  return `[Image #${pastedContentId}]`
}

export function buildPromptPlaceholderLabel(token: PromptReferenceToken): string {
  const needsQuotes = /\s/.test(token.display)

  switch (token.kind) {
    case 'diff':
      return '@diff'
    case 'staged':
      return '@staged'
    case 'git':
      return `@git:${token.display}`
    case 'commit':
      return `@commit:${token.display}`
    case 'url':
      return `@url:${token.display}`
    case 'image':
      return token.target.kind === 'image' &&
        typeof token.target.pastedContentId === 'number'
        ? formatImageRef(token.target.pastedContentId)
        : token.display
    default:
      return needsQuotes ? `@"${token.display}"` : `@${token.display}`
  }
}

export function buildPromptInlinePreview(token: PromptReferenceToken): string {
  switch (token.kind) {
    case 'file':
      return `file ${token.display}`
    case 'folder':
      return `folder ${token.display}`
    case 'git':
      return `commit ${token.display}`
    case 'commit':
      return token.target.kind === 'commit' && token.target.subject
        ? `commit ${token.display} — ${token.target.subject}`
        : `commit ${token.display}`
    case 'url':
      return `url ${token.display}`
    case 'image':
      return `image ${token.display}`
    default:
      return token.display
  }
}
