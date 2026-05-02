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

// Compact 5-row variant — keeps a coherent avocado silhouette by retaining
// top tip, upper curve, body, closing curve, and base. Drops only the dense
// duplicate upper row and one near-identical middle row from RAW_LINES.
const COMPACT_LINES: ReadonlyArray<string> = [
  '⣶⣄⡀          ⢀⣴',
  '⣿⣾ ⠙⢾⣿⡄    ⣿⣷',
  '⣿⣿   ⢸⣷⡇    ⣿⣽',
  '⠘⣿⣵⣄⠸⣷⣇⢀⣠⣾⣿⠋',
  '  ⠈⠙⠽⢧⡹⠾⡿⠻⠓⠁',
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
