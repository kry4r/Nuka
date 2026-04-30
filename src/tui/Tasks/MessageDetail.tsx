// src/tui/Tasks/MessageDetail.tsx
import * as React from 'react'
import { Box, Text } from 'ink'
import type { MessageEnvelope } from '../../core/messaging/types'
import { useTheme } from '../../core/theme/context'
import { defaultPalette } from '../theme'

export function MessageDetail(p: { envelope: MessageEnvelope }): React.ReactNode {
  const theme = useTheme()
  const fgMutedColor = theme.colors.fgMuted ?? defaultPalette.fgMuted
  const body = typeof p.envelope.message === 'string' ? p.envelope.message : JSON.stringify(p.envelope.message, null, 2)
  return (
    <Box flexDirection="column" borderStyle="round">
      <Text bold>{p.envelope.from} → {p.envelope.to}</Text>
      <Text dimColor>{new Date(p.envelope.sentAt).toISOString()}</Text>
      <Text>{p.envelope.summary}</Text>
      <Box marginY={1}><Text>{body}</Text></Box>
      <Text color={fgMutedColor}>[r] reply · [esc] back</Text>
    </Box>
  )
}
