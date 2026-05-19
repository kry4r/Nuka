// src/tui/Messages/ToolCall.tsx
import React from 'react'
import { Box, Text, useStdout } from 'ink'
import { truncateByWidth } from '../../core/stringWidth'
import { defaultPalette as P } from '../theme'

export function ToolCall(props: {
  name: string
  argSummary: string
  status: 'running' | 'ok' | 'error'
  durationMs?: number
  progressLines?: string[]
  source?: 'builtin' | 'skill' | 'plugin'
  annotations?: { readOnly?: boolean; destructive?: boolean; openWorld?: boolean }
}): React.JSX.Element {
  const { stdout } = useStdout()
  const columns = process.stdout.columns ?? stdout?.columns ?? 80
  const icon = props.status === 'ok' ? '✓' : props.status === 'error' ? '✗' : '…'
  const iconColor = props.status === 'error' ? P.error : P.success

  const lines = props.progressLines ?? []
  const displayLines = props.status === 'running'
    ? lines.slice(-10)
    : lines.slice(-5)

  const displayName = props.name

  // marginLeft=2 + 2 border chars = 4 chrome columns reserved.
  const boxWidth = Math.max(20, columns - 4)
  const innerCap = Math.max(1, boxWidth - 2)

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={P.accentCool}>⏺ </Text>
        <Text color={P.fg} bold>{displayName} </Text>
        {props.annotations?.openWorld && (
          <Text color={P.fgMuted} dimColor>(network) </Text>
        )}
        {props.source && props.source !== 'builtin' && (
          <Text color={P.fgMuted}>[{props.source}] </Text>
        )}
        <Text color={P.fgMuted}>{props.argSummary}</Text>
        {props.durationMs != null && (
          <Text color={P.fgMuted}>  {(props.durationMs / 1000).toFixed(1)}s</Text>
        )}
        <Text color={iconColor}> {icon}</Text>
      </Box>
      {displayLines.length > 0 && (
        <Box flexDirection="column" marginLeft={2} width={boxWidth} borderStyle="round" borderColor={P.fgMuted}>
          {displayLines.map((line, i) => (
            <Text key={i} color={P.fgMuted}>{truncateByWidth(line, innerCap)}</Text>
          ))}
        </Box>
      )}
    </Box>
  )
}
