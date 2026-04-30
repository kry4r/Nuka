// src/tui/Monitor/TokensView.tsx
import * as React from 'react'
import { Box, Text } from 'ink'
import { rollupTokens } from './rollupTokens'

export function TokensView(p: { usage: Array<{ agentName: string; inputTokens: number; outputTokens: number }> }): React.ReactNode {
  const r = rollupTokens(p.usage)
  return (
    <Box flexDirection="column">
      {Object.entries(r).map(([name, t]) => (
        <Text key={name}>{name.padEnd(20)} in: {t.inputTokens}  out: {t.outputTokens}</Text>
      ))}
    </Box>
  )
}
