// src/tui/Onboarding/Steps/Verifying.tsx
import React from 'react'
import { Box, Text } from 'ink'
import type { ProviderTemplate } from '../../../core/onboarding/templates'
import { defaultPalette as P } from '../../theme'

export function Verifying(props: {
  provider: ProviderTemplate
  model: string
}): React.JSX.Element {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={P.primary} paddingX={1}>
      <Text color={P.primary} bold>Verifying…</Text>
      <Text color={P.fg}>{props.provider.name} · {props.model}</Text>
      <Text color={P.fgMuted}>Sending a 1-token probe to confirm your API key works.</Text>
    </Box>
  )
}
