// src/tui/Conversation/Conversation.tsx
//
// Phase 12 §4.1 — the Conversation zone is the topmost frame in the
// four-zone layout. It wraps the existing Messages list with a single
// rounded-frame chrome so the user has a stable visual anchor for chat
// content. Welcome (the centered avocado logo) is rendered raw outside
// this frame at first launch; the frame applies once messages exist.
//
// `focused` drives the border colour through the focus-ring rule
// (§4.9): the active zone uses `primary`, others use `fgMuted` from
// the 12-key semantic palette.

import React from 'react'
import { Box, Text } from 'ink'
import { useTheme } from '../../core/theme/context'
import { defaultPalette } from '../theme'

export type ConversationProps = {
  /** When true, render the border with the focus-ring colour. */
  focused?: boolean
  children: React.ReactNode
}

export function Conversation(props: ConversationProps): React.JSX.Element {
  const theme = useTheme()
  const focusColor = theme.colors.primary ?? defaultPalette.primary
  const mutedColor = theme.colors.fgMuted ?? defaultPalette.fgMuted
  const borderColor = props.focused ? focusColor : mutedColor

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={borderColor}
      paddingX={1}
    >
      <Box>
        <Text color={borderColor}>Conversation</Text>
      </Box>
      <Box flexDirection="column">
        {props.children}
      </Box>
    </Box>
  )
}
