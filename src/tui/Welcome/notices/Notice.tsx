// src/tui/Welcome/notices/Notice.tsx
//
// Phase C — generic structural notice slot extracted from Nuka-Code's
// `VoiceModeNotice` / `Opus1mMergeNotice` family.  The Anthropic-branded
// content (Voice mode, Opus 1m, Channels, guest passes, overage credits)
// is intentionally not ported — this is the reusable shell Nuka can wrap
// around its own announcements.

import React from 'react'
import { Box, Text } from 'ink'
import { defaultPalette as P } from '../../theme'

export type NoticeProps = {
  /** When false, the notice renders nothing. */
  shouldShow: boolean
  /** Border / accent color (default `P.accentInfo`). */
  color?: string
  children: React.ReactNode
}

/**
 * A small bordered row that sits below the welcome box.  Caller controls
 * visibility via `shouldShow`; when false the component returns `null`.
 *
 *   <Notice shouldShow={hasNews} color={P.accentInfo}>
 *     <Text>New: try /recap to summarize the last hour.</Text>
 *   </Notice>
 */
export function Notice(props: NoticeProps): React.JSX.Element | null {
  const { shouldShow, color = P.accentInfo, children } = props
  if (!shouldShow) return null
  return (
    <Box
      paddingLeft={1}
      paddingRight={1}
      borderStyle="round"
      borderColor={color}
      flexDirection="row"
    >
      {typeof children === 'string'
        ? <Text color={color}>{children}</Text>
        : children}
    </Box>
  )
}
