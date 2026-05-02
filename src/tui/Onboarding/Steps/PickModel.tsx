// src/tui/Onboarding/Steps/PickModel.tsx
//
// Presentation only — input is owned by the Wizard root.
import React from 'react'
import { Box, Text } from 'ink'
import type { ProviderTemplate } from '../../../core/onboarding/templates'
import { defaultPalette as P } from '../../theme'

// Sliding window size — same shape as SlashCard/CommandList.
const WINDOW_SIZE = 12

export function PickModel(props: {
  provider: ProviderTemplate
  models: string[]
  cursor: number
}): React.JSX.Element {
  const total = props.models.length
  const sel = Math.max(0, Math.min(props.cursor, total - 1))

  // Compute window bounds centred on cursor; short-circuit when the list
  // already fits so we never paginate unnecessarily.
  let start: number
  let end: number
  if (total <= WINDOW_SIZE) {
    start = 0
    end = total
  } else {
    const half = Math.floor(WINDOW_SIZE / 2)
    start = Math.max(0, sel - half)
    end = Math.min(total, start + WINDOW_SIZE)
    if (end - start < WINDOW_SIZE) start = Math.max(0, end - WINDOW_SIZE)
  }
  const showUp = start > 0
  const showDown = end < total

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={P.primary} paddingX={1}>
      <Text color={P.primary} bold>Pick default model — {props.provider.name}</Text>
      <Text color={P.fgMuted}>↑↓ navigate · Enter select · ← back · Esc cancel</Text>
      {showUp && <Text color={P.fgMuted}>  ↑ more above</Text>}
      {props.models.slice(start, end).map((m, idx) => {
        const i = start + idx
        return (
          <Text key={m} color={i === sel ? P.primary : P.fg}>
            {i === sel ? '›' : ' '} {m}
          </Text>
        )
      })}
      {showDown && <Text color={P.fgMuted}>  ↓ more below</Text>}
    </Box>
  )
}
