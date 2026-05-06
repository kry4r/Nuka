import React from 'react'
import { Box, Text } from 'ink'
import stringWidth from 'string-width'
import { defaultPalette as P } from '../theme'

const LOGO_LINES = [
  '⣶⣄⡀⠀⠀⠀⠀⠀⠀⠀⢀⣴',
  '⣿⣿⣻⣷⣦⡀⠀⠀⠀⠀⣾⣿',
  '⣿⣾⠀⠙⢾⣿⡄⠀⠀⠀⣿⣷',
  '⣿⣿⠀⠀⢸⣷⡇⠀⠀⠀⣿⣽',
  '⣿⣾⠀⠀⢸⣷⡇⠀⠀⠀⣿⣻',
  '⠘⣿⣵⣄⠸⣷⣇⢀⣠⣾⣿⠋',
  '⠈⠙⠽⢧⡹⠾⡿⠻⠓⠁',
] as const

export const CLAWD_HEIGHT = LOGO_LINES.length
export const CLAWD_WIDTH = Math.max(...LOGO_LINES.map(l => stringWidth(l)))

export function Clawd(): React.JSX.Element {
  return (
    <Box flexDirection="column" alignItems="center">
      {LOGO_LINES.map((line, i) => {
        const isShell = i < 2 || i === LOGO_LINES.length - 1
        return (
          <Text key={i} color={isShell ? P.primary : P.primarySoft}>
            {line}
          </Text>
        )
      })}
    </Box>
  )
}
