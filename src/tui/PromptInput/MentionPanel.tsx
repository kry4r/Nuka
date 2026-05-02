// src/tui/PromptInput/MentionPanel.tsx
import React from 'react'
import { Box, Text } from 'ink'
import stringWidth from 'string-width'
import { defaultPalette as P } from '../theme'
import { useTerminalSize } from '../hooks/useTerminalSize'

/**
 * Leading-ellipsis truncation: keeps the tail (filename) visible.
 * Used for paths: "src/foo/bar/baz/very-long.ts" → "…/very-long.ts".
 */
function truncatePathLeading(path: string, maxWidth: number): string {
  if (maxWidth <= 0) return ''
  if (stringWidth(path) <= maxWidth) return path
  // Reserve 1 col for the leading "…".
  const budget = maxWidth - 1
  const chars = Array.from(path)
  let width = 0
  let i = chars.length
  while (i > 0) {
    const ch = chars[i - 1]!
    const w = stringWidth(ch)
    if (width + w > budget) break
    width += w
    i--
  }
  return '…' + chars.slice(i).join('')
}

export function MentionPanel(props: {
  query: string
  matches: string[]
  cursor: number
  onSelect: (path: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const { columns } = useTerminalSize()
  // 6 cols of chrome: paddingX(2) + cursor marker " ›" + space (~3) + safety.
  const maxPathWidth = Math.max(8, columns - 6)
  if (props.matches.length === 0) {
    return (
      <Box paddingX={1}>
        <Text color={P.fgMuted}>  @{props.query}  (no matches)</Text>
      </Box>
    )
  }
  return (
    <Box flexDirection="column" paddingX={1}>
      {props.matches.slice(0, 10).map((m, i) => (
        <Box key={m}>
          <Text color={i === props.cursor ? P.primary : P.fgMuted}>
            {i === props.cursor ? '›' : ' '} {truncatePathLeading(m, maxPathWidth)}
          </Text>
        </Box>
      ))}
    </Box>
  )
}
