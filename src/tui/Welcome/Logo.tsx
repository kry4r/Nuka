import React from 'react'
import { Box, Text } from 'ink'
import { defaultPalette } from '../theme'

// 3D ANSI Shadow style "NUKA" — 6 rows × 35 columns.
// Built from FULL BLOCK (█) plus double-line box drawing (╗ ║ ╝ ═ ╚ ╔)
// to evoke a pseudo-3D extrusion (right/bottom shadow). Each row is exactly
// 35 display columns wide so the figure has a clean rectangular bounding box.
const RAW_LINES: ReadonlyArray<string> = [
  '███╗   ██╗██╗   ██╗██╗  ██╗ █████╗ ',
  '████╗  ██║██║   ██║██║ ██╔╝██╔══██╗',
  '██╔██╗ ██║██║   ██║█████╔╝ ███████║',
  '██║╚██╗██║██║   ██║██╔═██╗ ██╔══██║',
  '██║ ╚████║╚██████╔╝██║  ██╗██║  ██║',
  '╚═╝  ╚═══╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝',
]

// Compact 4-row variant for short terminals — keeps the wordmark legible by
// retaining the top "tip" row, one mid-body row, the closing-curve row, and
// the bottom shadow row. Same 35-column width as the full version.
const COMPACT_LINES: ReadonlyArray<string> = [
  '███╗   ██╗██╗   ██╗██╗  ██╗ █████╗ ',
  '██╔██╗ ██║██║   ██║█████╔╝ ███████║',
  '██║ ╚████║╚██████╔╝██║  ██╗██║  ██║',
  '╚═╝  ╚═══╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝',
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
