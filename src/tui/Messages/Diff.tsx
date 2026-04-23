// src/tui/Messages/Diff.tsx
import React from 'react'
import { Box, Text } from 'ink'
import { createPatch } from 'diff'
import { defaultPalette as P } from '../theme'

export function Diff({
  path, before, after,
}: { path: string; before: string; after: string }): React.JSX.Element {
  const patch = createPatch(path, before, after, '', '', { context: 2 })
  return (
    <Box flexDirection="column">
      {patch.split('\n').map((line, i) => {
        const color = line.startsWith('+') && !line.startsWith('+++')
          ? P.success
          : line.startsWith('-') && !line.startsWith('---')
          ? P.error
          : P.muted
        return <Text key={i} color={color}>{line}</Text>
      })}
    </Box>
  )
}
