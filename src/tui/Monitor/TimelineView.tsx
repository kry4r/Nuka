// src/tui/Monitor/TimelineView.tsx
import * as React from 'react'
import { Box, Text } from 'ink'
import { bucketTimeline, type TimelineLane } from './bucketTimeline'
import { useTheme } from '../../core/theme/context'
import { defaultPalette } from '../theme'

export function TimelineView(p: { events: Array<{ t: number; topic: TimelineLane }> }): React.ReactNode {
  const theme = useTheme()
  const primaryColor = theme.colors.primary ?? defaultPalette.primary
  const fgMutedColor = theme.colors.fgMuted ?? defaultPalette.fgMuted
  const startMs = Date.now() - 60 * 60_000
  const buckets = bucketTimeline(p.events, startMs, 60)
  const bar = (n: number): string => '▆'.repeat(Math.min(n, 8))
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={fgMutedColor}>Lanes: </Text>
        <Text color={primaryColor}>task</Text>
        <Text color={fgMutedColor}> · </Text>
        <Text color="yellow">agent</Text>
        <Text color={fgMutedColor}> · </Text>
        <Text color="cyan">msg</Text>
        <Text color={fgMutedColor}> · </Text>
        <Text color="magenta">coord</Text>
      </Box>
      {buckets.slice(-30).map(b => (
        <Box key={b.bucketStart}>
          <Text color={fgMutedColor}>{new Date(b.bucketStart).toISOString().slice(11, 16)} </Text>
          <Text color={primaryColor}>{bar(b.task)}</Text>
          <Text color="yellow">{bar(b.agent)}</Text>
          <Text color="cyan">{bar(b.message)}</Text>
          <Text color="magenta">{bar(b.coordination)}</Text>
        </Box>
      ))}
    </Box>
  )
}
