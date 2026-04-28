// src/tui/Onboarding/Steps/PickProvider.tsx
//
// Presentation only — input is owned by the Wizard root.
import React from 'react'
import { Box, Text } from 'ink'
import type { ProviderTemplate } from '../../../core/onboarding/templates'
import { defaultPalette as P } from '../../theme'

export function PickProvider(props: {
  choices: ProviderTemplate[]
  cursor: number
}): React.JSX.Element {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={P.primary} paddingX={1}>
      <Text color={P.primary} bold>Choose a provider</Text>
      <Text color={P.fgMuted}>↑↓ navigate · Enter select · Esc cancel</Text>
      {props.choices.map((t, i) => (
        <Text key={t.id} color={i === props.cursor ? P.primary : P.fg}>
          {i === props.cursor ? '›' : ' '} {t.name}  <Text color={P.fgMuted}>{t.baseUrl}</Text>
        </Text>
      ))}
    </Box>
  )
}
