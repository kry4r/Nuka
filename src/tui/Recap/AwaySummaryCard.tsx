// src/tui/Recap/AwaySummaryCard.tsx — Phase 14c §5.3
import * as React from 'react'
import { Box, Text } from 'ink'

// NOTE: The component had a "[esc] dismiss" hint but no useInput handler
// hooked up — pressing Esc never called onDismiss. Per spec choice (b)
// (P2 #44) we remove the misleading line so the footer stops promising
// behavior the component doesn't deliver. The `onDismiss` prop is kept
// for future use (no-op until a caller wires up its own dismissal flow).
export function AwaySummaryCard(p: { text: string; onDismiss: () => void }): React.ReactNode {
  void p.onDismiss
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text dimColor>※ While you were away</Text>
      <Text>{p.text}</Text>
    </Box>
  )
}
