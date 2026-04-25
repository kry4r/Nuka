// src/tui/Onboarding/Steps/Done.tsx
//
// Presentation only — input is owned by the Wizard root.
import React from 'react'
import { Box, Text } from 'ink'
import type { ConfigPatch } from '../../../core/onboarding/wizard'
import { defaultPalette as P } from '../../theme'

export function Done(props: { config: ConfigPatch }): React.JSX.Element {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={P.success} paddingX={1}>
      <Text color={P.success} bold>All set</Text>
      <Text color={P.fg}>Provider: {props.config.name}</Text>
      <Text color={P.fg}>Default model: {props.config.selectedModel}</Text>
      <Text color={P.muted}>Saving and continuing…</Text>
    </Box>
  )
}
