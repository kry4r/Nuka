// src/tui/design-system/Pane.tsx
//
// Phase C — port of Nuka-Code's Pane.  A region bounded by a colored top
// divider line, with a one-row gap above and horizontal padding around the
// body.  Used by slash-command screens that don't need a full rounded card.
//
// Note: this is NOT a superset of `BorderedBox` (which renders a rounded
// border with inline title) — both primitives stay in the codebase, picked
// per use-case.

import React from 'react'
import { Box } from 'ink'
import { Divider } from './Divider'

export type PaneProps = {
  children: React.ReactNode
  /** Theme color for the top divider line.  When unset, renders dim. */
  color?: string
}

export function Pane({ children, color }: PaneProps): React.JSX.Element {
  return (
    <Box flexDirection="column" paddingTop={1}>
      <Divider color={color} />
      <Box flexDirection="column" paddingX={2}>{children}</Box>
    </Box>
  )
}
