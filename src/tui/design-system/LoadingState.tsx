// src/tui/design-system/LoadingState.tsx
//
// Phase C — port of Nuka-Code's LoadingState.  Nuka-Code uses an animated
// `<Spinner />`; Nuka doesn't ship `ink-spinner` and Phase C is a no-deps
// port, so we render a static `…` glyph in front of the message.  A future
// pass can swap to a real spinner without changing the call sites.

import React from 'react'
import { Box, Text } from 'ink'

export type LoadingStateProps = {
  /** The loading message displayed next to the glyph. */
  message: string
  /** Render the message in bold. */
  bold?: boolean
  /** Render the message dim. */
  dimColor?: boolean
  /** Optional subtitle row below the main message. */
  subtitle?: string
}

export function LoadingState(props: LoadingStateProps): React.JSX.Element {
  const { message, bold = false, dimColor = false, subtitle } = props
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text>{'\u2026'}</Text>
        <Text bold={bold} dimColor={dimColor}> {message}</Text>
      </Box>
      {subtitle && <Text dimColor>{subtitle}</Text>}
    </Box>
  )
}
