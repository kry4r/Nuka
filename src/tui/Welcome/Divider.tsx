// src/tui/Welcome/Divider.tsx
//
// Phase B — minimal horizontal rule used by FeedColumn between stacked
// Feed blocks.  Renders a single line of `─` repeated `width` times.

import React from 'react'
import { Text } from 'ink'

export type DividerProps = {
  /** Theme color (e.g. P.primary).  Falls back to default text color. */
  color?: string
  /** Width in display columns. */
  width: number
}

export function Divider({ color, width }: DividerProps): React.JSX.Element {
  return <Text color={color}>{'\u2500'.repeat(Math.max(0, width))}</Text>
}
