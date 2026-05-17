// src/tui/promptMentions/AtomicChip.tsx
//
// Atomic chip — renders a single resolved @-mention (or in-flight draft chip)
// as an inline, visually distinct unit inside the prompt input.
//
// The chip is a *display* component. It takes a PromptReferenceToken
// (from src/promptContextReferences/types.ts) and renders a compact label
// using buildPromptPlaceholderLabel() so it matches the canonical text form
// that lives inside draft.text.
//
// Stateless / colour-driven: status maps to one of Nuka's 12 semantic palette
// keys. Focused chips invert (selected at the atomic-cursor boundary), so the
// caller drives focus by passing `focused`.
//
// Iter 3b will wire this into PromptInput where today the raw placeholder
// label is rendered as plain text inside <Text>.

import React from 'react'
import { Box, Text } from 'ink'
import { defaultPalette as P } from '../theme'
import type { Palette } from '../theme'
import { buildPromptPlaceholderLabel } from '../../promptContextReferences/display'
import type {
  PromptReferenceStatus,
  PromptReferenceToken,
} from '../../promptContextReferences/types'

export type AtomicChipProps = {
  /** The token to render. `display` + `kind` drive the label. */
  token: PromptReferenceToken
  /** When true the chip renders inverse-coloured (atomic cursor on chip). */
  focused?: boolean
  /** Override label; defaults to buildPromptPlaceholderLabel(token). */
  label?: string
  /** Override palette (defaults to defaultPalette). */
  palette?: Palette
}

function statusColor(p: Palette, status: PromptReferenceStatus): string {
  switch (status) {
    case 'invalid':
      return p.error
    case 'stale':
      return p.warn
    case 'resolving':
      return p.accentInfo
    case 'draft':
      return p.fgMuted
    case 'valid':
    default:
      return p.primary
  }
}

export function AtomicChip(props: AtomicChipProps): React.JSX.Element {
  const p = props.palette ?? P
  const text = props.label ?? buildPromptPlaceholderLabel(props.token)
  const color = statusColor(p, props.token.status)
  const focused = props.focused ?? false

  return (
    <Box flexShrink={0}>
      <Text color={color} inverse={focused} bold={focused}>
        {text}
      </Text>
    </Box>
  )
}
