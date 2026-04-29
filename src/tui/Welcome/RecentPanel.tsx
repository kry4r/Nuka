// src/tui/Welcome/RecentPanel.tsx
//
// Phase 13 M2 — Recent sessions panel for the Welcome screen right column.
// Shows up to 6 recent sessions with first-user-message preview.
// Empty state: shows "(no recent sessions)" in fgFaint.

import React from 'react'
import { Box, Text } from 'ink'
import { defaultPalette as P } from '../theme'
import type { RecentEntry } from '../../core/session/recent'

export type RecentPanelProps = {
  recent: RecentEntry[]
}

export function RecentPanel({ recent }: RecentPanelProps): React.JSX.Element {
  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      borderStyle="round"
      borderColor={P.fgMuted}
      paddingX={1}
    >
      <Text color={P.accentInfo} bold>Recent</Text>
      {recent.length === 0 ? (
        <Text color={P.fgFaint}>(no recent sessions)</Text>
      ) : (
        recent.map((entry, i) => (
          <Text key={i} color={P.fgMuted}>{entry.preview}</Text>
        ))
      )}
    </Box>
  )
}
