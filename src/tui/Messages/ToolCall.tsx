// src/tui/Messages/ToolCall.tsx
import React from 'react'
import { Box, Text } from 'ink'
import { defaultPalette as P } from '../theme'

export function ToolCall(props: {
  name: string
  argSummary: string
  status: 'running' | 'ok' | 'error'
  durationMs?: number
  progressLines?: string[]
  source?: 'builtin' | 'skill' | 'mcp' | 'plugin'
}): React.JSX.Element {
  const icon = props.status === 'ok' ? '✓' : props.status === 'error' ? '✗' : '…'
  const iconColor = props.status === 'error' ? P.error : P.success

  const lines = props.progressLines ?? []
  const displayLines = props.status === 'running'
    ? lines.slice(-10)
    : lines.slice(-5)

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={P.accent}>⏺ </Text>
        <Text color={P.fg} bold>{props.name} </Text>
        {props.source && props.source !== 'builtin' && (
          <Text color={P.muted}>[{props.source}] </Text>
        )}
        <Text color={P.muted}>{props.argSummary}</Text>
        {props.durationMs != null && (
          <Text color={P.muted}>  {(props.durationMs / 1000).toFixed(1)}s</Text>
        )}
        <Text color={iconColor}> {icon}</Text>
      </Box>
      {displayLines.length > 0 && (
        <Box flexDirection="column" marginLeft={2} borderStyle="round" borderColor={P.muted}>
          {displayLines.map((line, i) => (
            <Text key={i} color={P.muted}>{line.slice(0, 120)}</Text>
          ))}
        </Box>
      )}
    </Box>
  )
}
