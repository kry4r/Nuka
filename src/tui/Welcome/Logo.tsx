import React from 'react'
import { Box, Text } from 'ink'
import { defaultPalette } from '../theme'

// Original braille avocado mark. Each line is right-padded to the longest
// line so the figure has a consistent rectangular bounding box and adjacent
// columns don't shift between rows.
const RAW_LINES: ReadonlyArray<string> = [
  '⣶⣄⡀          ⢀⣴',
  '⣿⣿⣻⣷⣦⡀      ⣾⣿',
  '⣿⣾ ⠙⢾⣿⡄    ⣿⣷',
  '⣿⣿   ⢸⣷⡇    ⣿⣽',
  '⣿⣾   ⢸⣷⡇    ⣿⣻',
  '⠘⣿⣵⣄⠸⣷⣇⢀⣠⣾⣿⠋',
  '  ⠈⠙⠽⢧⡹⠾⡿⠻⠓⠁',
]

// Compact 3-row variant — keeps the avocado silhouette but trims top/bottom
// rows so the Welcome hero block fits roughly half a 30-row terminal.
const COMPACT_LINES: ReadonlyArray<string> = [
  '⣿⣾ ⠙⢾⣿⡄    ⣿⣷',
  '⣿⣾   ⢸⣷⡇    ⣿⣻',
  '⠘⣿⣵⣄⠸⣷⣇⢀⣠⣾⣿⠋',
]

export const LOGO_WIDTH = RAW_LINES.reduce((m, l) => Math.max(m, l.length), 0)
const LOGO_LINES = RAW_LINES.map(l => l + ' '.repeat(LOGO_WIDTH - l.length))
const COMPACT_LOGO_LINES = COMPACT_LINES.map(l => l + ' '.repeat(LOGO_WIDTH - l.length))

export function Logo({ color, compact }: { color?: string; compact?: boolean } = {}): React.JSX.Element {
  const lines = compact ? COMPACT_LOGO_LINES : LOGO_LINES
  return (
    <Box flexDirection="column" width={LOGO_WIDTH}>
      {lines.map((line, i) => (
        <Text key={i} color={color ?? defaultPalette.primary}>{line}</Text>
      ))}
    </Box>
  )
}
