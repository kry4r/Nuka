// src/tui/Messages/ToolCall.tsx
import React from 'react'
import { Box, Text } from 'ink'
import { defaultPalette as P } from '../theme'

export function ToolCall(props: {
  name: string
  argSummary: string
  status: 'running' | 'ok' | 'error'
  durationMs?: number
}): React.JSX.Element {
  const icon = props.status === 'ok' ? '✓' : props.status === 'error' ? '✗' : '…'
  const iconColor = props.status === 'error' ? P.error : P.success
  return (
    <Box>
      <Text color={P.accent}>⏺ </Text>
      <Text color={P.fg} bold>{props.name} </Text>
      <Text color={P.muted}>{props.argSummary}</Text>
      {props.durationMs != null && (
        <Text color={P.muted}>  {(props.durationMs / 1000).toFixed(1)}s</Text>
      )}
      <Text color={iconColor}> {icon}</Text>
    </Box>
  )
}
