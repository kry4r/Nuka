// src/tui/Onboarding/Steps/PickModel.tsx
//
// Presentation only — input is owned by the Wizard root.
import React from 'react'
import { Box, Text } from 'ink'
import type { ProviderTemplate } from '../../../core/onboarding/templates'
import { defaultPalette as P } from '../../theme'

export function PickModel(props: {
  provider: ProviderTemplate
  models: string[]
  cursor: number
}): React.JSX.Element {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={P.primary} paddingX={1}>
      <Text color={P.primary} bold>Pick default model — {props.provider.name}</Text>
      <Text color={P.fgMuted}>↑↓ navigate · Enter select · ← back · Esc cancel</Text>
      {props.models.map((m, i) => (
        <Text key={m} color={i === props.cursor ? P.primary : P.fg}>
          {i === props.cursor ? '›' : ' '} {m}
        </Text>
      ))}
    </Box>
  )
}
