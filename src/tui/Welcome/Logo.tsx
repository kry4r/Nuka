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

export const LOGO_WIDTH = RAW_LINES.reduce((m, l) => Math.max(m, l.length), 0)
const LOGO_LINES = RAW_LINES.map(l => l + ' '.repeat(LOGO_WIDTH - l.length))

export function Logo({ color }: { color?: string } = {}): React.JSX.Element {
  return (
    <Box flexDirection="column" width={LOGO_WIDTH}>
      {LOGO_LINES.map((line, i) => (
        <Text key={i} color={color ?? defaultPalette.primary}>{line}</Text>
      ))}
    </Box>
  )
}
