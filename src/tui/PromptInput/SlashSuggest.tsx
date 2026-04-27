// src/tui/PromptInput/SlashSuggest.tsx
//
// Vertical scrollable list of slash candidates rendered BELOW the input.
// Window of `WINDOW_SIZE` items keeps the selection visible no matter how
// many commands are registered, so users can scroll the dropdown by
// pressing ↑/↓ instead of seeing a fixed slice.

import React from 'react'
import { Box, Text } from 'ink'
import { defaultPalette as P } from '../theme'

const WINDOW_SIZE = 8

export function SlashSuggest(props: {
  candidates: { name: string; description: string }[]
  selectedIndex: number
}): React.JSX.Element | null {
  const total = props.candidates.length
  if (total === 0) return null

  // Compute a sliding window centred on the selection.
  const sel = Math.max(0, Math.min(props.selectedIndex, total - 1))
  let start = Math.max(0, sel - Math.floor(WINDOW_SIZE / 2))
  let end = Math.min(total, start + WINDOW_SIZE)
  if (end - start < WINDOW_SIZE) start = Math.max(0, end - WINDOW_SIZE)
  const slice = props.candidates.slice(start, end)
  const showUp = start > 0
  const showDown = end < total

  return (
    <Box flexDirection="column" paddingX={1}>
      {showUp && (
        <Text color={P.muted}>  ↑ {start} more above</Text>
      )}
      {slice.map((c, i) => {
        const realIdx = start + i
        const selected = realIdx === sel
        return (
          <Box key={c.name}>
            <Text color={selected ? P.primary : P.muted}>
              {selected ? '›' : ' '} /{c.name.padEnd(11)}  {c.description}
            </Text>
          </Box>
        )
      })}
      {showDown && (
        <Text color={P.muted}>  ↓ {total - end} more below</Text>
      )}
    </Box>
  )
}
