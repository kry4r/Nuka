// src/tui/Recap/AwaySummaryCard.tsx — Phase 14c §5.3
import * as React from 'react'
import { Box, Text } from 'ink'

export function AwaySummaryCard(p: { text: string; onDismiss: () => void }): React.ReactNode {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text dimColor>※ While you were away</Text>
      <Text>{p.text}</Text>
      <Text dimColor>[esc] dismiss</Text>
    </Box>
  )
}
