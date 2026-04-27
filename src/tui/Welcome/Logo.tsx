import React from 'react'
import { Box, Text } from 'ink'
import { defaultPalette } from '../theme'

// Each line is padded with trailing spaces to LOGO_WIDTH so the right edge
// is flush regardless of how the terminal sizes individual braille glyphs.
// The leading-space column on the last line preserves the curl of the dot
// without shifting the rest of the figure.
const LOGO_WIDTH = 14
const RAW_LINES: ReadonlyArray<string> = [
  '⣶⣄⡀          ⢀⣴',
  '⣿⣿⣻⣷⣦⡀      ⣾⣿',
  '⣿⣾ ⠙⢾⣿⡄    ⣿⣷',
  '⣿⣿   ⢸⣷⡇    ⣿⣽',
  '⣿⣾   ⢸⣷⡇    ⣿⣻',
  '⠘⣿⣵⣄⠸⣷⣇⢀⣠⣾⣿⠋',
  '  ⠈⠙⠽⢧⡹⠾⡿⠻⠓⠁',
]

function pad(line: string, w: number): string {
  // Each braille / box character occupies one terminal column in monospace
  // fonts, so we can pad by character count.
  if (line.length >= w) return line
  return line + ' '.repeat(w - line.length)
}

const LOGO_LINES = RAW_LINES.map(l => pad(l, LOGO_WIDTH))

export function Logo(): React.JSX.Element {
  return (
    <Box flexDirection="column" width={LOGO_WIDTH}>
      {LOGO_LINES.map((line, i) => (
        <Text key={i} color={defaultPalette.primary}>{line}</Text>
      ))}
    </Box>
  )
}
