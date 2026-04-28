// src/tui/Onboarding/Steps/EnterKey.tsx
//
// Presentation only — input is owned by the Wizard root.
import React from 'react'
import { Box, Text } from 'ink'
import type { ProviderTemplate } from '../../../core/onboarding/templates'
import { defaultPalette as P } from '../../theme'

export function EnterKey(props: {
  provider: ProviderTemplate
  value: string
}): React.JSX.Element {
  const masked = props.value.length > 0
    ? props.value.slice(0, 4) + '*'.repeat(Math.max(0, props.value.length - 4))
    : ''
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={P.primary} paddingX={1}>
      <Text color={P.primary} bold>Enter API key for {props.provider.name}</Text>
      <Text color={P.fgMuted}>env: {props.provider.apiKeyEnvVar} · help: {props.provider.helpUrl}</Text>
      <Box marginTop={1}>
        <Text color={P.fg}>key: </Text>
        <Text color={P.accentCool}>{masked || ' '}</Text>
        <Text color={P.fgMuted}> ({props.value.length} chars)</Text>
      </Box>
      <Text color={P.fgMuted}>Enter submit · Esc cancel · ← back</Text>
    </Box>
  )
}
