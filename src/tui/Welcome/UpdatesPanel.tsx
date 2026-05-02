// src/tui/Welcome/UpdatesPanel.tsx
//
// Phase 13 M2 — Updates panel for the Welcome screen right column.
// Shows up to 6 update entries from ~/.nuka/updates.json.
// Empty state: shows "(no updates)" in fgFaint.

import React from 'react'
import { Box, Text } from 'ink'
import { defaultPalette as P } from '../theme'
import type { UpdateEntry } from '../../core/updates/load'

export type UpdatesPanelProps = {
  updates: UpdateEntry[]
}

export function UpdatesPanel({ updates }: UpdatesPanelProps): React.JSX.Element {
  return (
    <Box
      flexDirection="column"
      flexShrink={1}
      borderStyle="round"
      borderColor={P.fgMuted}
      paddingX={1}
    >
      <Text color={P.accentInfo} bold>Updates</Text>
      {updates.length === 0 ? (
        <Text color={P.fgFaint}>(no updates)</Text>
      ) : (
        updates.map((entry, i) => (
          <Box key={i} flexDirection="column">
            {i > 0 && <Box height={1} />}
            {entry.title && (
              <Text color={P.fg} bold>
                {entry.version ? `${entry.version} — ` : ''}{entry.title}
                {entry.date ? <Text color={P.fgFaint}> {entry.date}</Text> : null}
              </Text>
            )}
            {(entry.bullets ?? []).map((b, j) => (
              <Text key={j} color={P.fgMuted}> · {b}</Text>
            ))}
          </Box>
        ))
      )}
    </Box>
  )
}
