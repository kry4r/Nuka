// src/tui/PromptInput/SlashSuggest.tsx
import React from 'react'
import { Box, Text } from 'ink'
import { defaultPalette as P } from '../theme'

export function SlashSuggest(props: {
  candidates: { name: string; description: string }[]
  selectedIndex: number
}): React.JSX.Element | null {
  if (props.candidates.length === 0) return null
  return (
    <Box flexDirection="column" paddingX={1}>
      {props.candidates.slice(0, 6).map((c, i) => (
        <Box key={c.name}>
          <Text color={i === props.selectedIndex ? P.primary : P.muted}>
            {i === props.selectedIndex ? '›' : ' '} /{c.name.padEnd(10)}  {c.description}
          </Text>
        </Box>
      ))}
    </Box>
  )
}
