// src/tui/design-system/Divider.tsx
//
// Phase C — rich Divider port from Nuka-Code's design-system.  Supersedes
// the minimal Phase B `src/tui/Welcome/Divider.tsx`.  Adds: optional title
// in the middle (e.g. ─── Title ───), default-width via terminal columns,
// padding subtraction, and char override.

import React from 'react'
import { Text } from 'ink'
import stringWidth from 'string-width'
import { useTerminalSize } from '../hooks/useTerminalSize'

export type DividerProps = {
  /** Width in display columns. Defaults to terminal width. */
  width?: number
  /** Theme color value (e.g. P.primary). When unset, renders dim. */
  color?: string
  /** Glyph to repeat. Default `─`. */
  char?: string
  /** Subtract this many columns from the resolved width. */
  padding?: number
  /** Optional title centered in the divider line. */
  title?: string
}

export function Divider(props: DividerProps): React.JSX.Element {
  const { width, color, char = '\u2500', padding = 0, title } = props
  const { columns: terminalWidth } = useTerminalSize()
  const effectiveWidth = Math.max(0, (width ?? terminalWidth) - padding)

  if (title) {
    const titleSlot = stringWidth(title) + 2 // " title "
    const sideWidth = Math.max(0, effectiveWidth - titleSlot)
    const leftWidth = Math.floor(sideWidth / 2)
    const rightWidth = sideWidth - leftWidth
    return (
      <Text color={color} dimColor={!color}>
        {char.repeat(leftWidth)} {title} {char.repeat(rightWidth)}
      </Text>
    )
  }
  return (
    <Text color={color} dimColor={!color}>
      {char.repeat(effectiveWidth)}
    </Text>
  )
}
