// src/tui/Monitor/TokensView.tsx
import * as React from 'react'
import { Box, Text } from 'ink'
import { rollupTokens } from './rollupTokens'
import { padToWidth, truncateByWidth } from '../../core/stringWidth'

const AGENT_NAME_WIDTH = 20

export function TokensView(p: { usage: Array<{ agentName: string; inputTokens: number; outputTokens: number }> }): React.ReactNode {
  const r = rollupTokens(p.usage)
  return (
    <Box flexDirection="column">
      {Object.entries(r).map(([name, t]) => {
        const agentName = padToWidth(truncateByWidth(name, AGENT_NAME_WIDTH), AGENT_NAME_WIDTH)
        return (
          <Text key={name}>{agentName} in: {t.inputTokens}  out: {t.outputTokens}</Text>
        )
      })}
    </Box>
  )
}
