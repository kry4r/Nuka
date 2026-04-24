// src/tui/PromptInput/MentionPanel.tsx
import React from 'react'
import { Box, Text } from 'ink'
import { defaultPalette as P } from '../theme'

export function MentionPanel(props: {
  query: string
  matches: string[]
  cursor: number
  onSelect: (path: string) => void
  onCancel: () => void
}): React.JSX.Element {
  if (props.matches.length === 0) {
    return (
      <Box paddingX={1}>
        <Text color={P.muted}>  @{props.query}  (no matches)</Text>
      </Box>
    )
  }
  return (
    <Box flexDirection="column" paddingX={1}>
      {props.matches.slice(0, 10).map((m, i) => (
        <Box key={m}>
          <Text color={i === props.cursor ? P.primary : P.muted}>
            {i === props.cursor ? '›' : ' '} {m}
          </Text>
        </Box>
      ))}
    </Box>
  )
}
