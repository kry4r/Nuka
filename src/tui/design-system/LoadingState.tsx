// src/tui/design-system/LoadingState.tsx
//
// Phase D3 — Nuka's signature pending visual.  Unlike Nuka-Code (which uses
// a generic ink-spinner), Nuka rotates a small lightning glyph + directional
// arrow to evoke spinning energy.  Frames are width-stable (3 cols each) so
// the row never jitters, theme.primary colors the glyph (avocado green).
//
// Animation: 100ms setInterval cycles through FRAMES; cleared on unmount so
// no timers leak.

import React, { useEffect, useState } from 'react'
import { Box, Text } from 'ink'
import { defaultPalette as P } from '../theme'

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

/**
 * Width-stable rotating lightning frames (3 cols each via stringWidth).
 * `⚡` is EAW Ambiguous (often 2 cols), so each frame pads it with a 1-col
 * directional arrow to lock the slot to a stable 3 columns regardless of
 * which arrow is shown.
 */
export const LOADING_FRAMES: readonly string[] = ['\u26A1\u2197', '\u26A1\u2198', '\u26A1\u2199', '\u26A1\u2196']
const FRAME_INTERVAL_MS = 100

export function LoadingState(props: LoadingStateProps): React.JSX.Element {
  const { message, bold = false, dimColor = false, subtitle } = props
  const [frameIndex, setFrameIndex] = useState(0)
  useEffect(() => {
    const id = setInterval(() => {
      setFrameIndex(i => (i + 1) % LOADING_FRAMES.length)
    }, FRAME_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text color={P.primary}>{LOADING_FRAMES[frameIndex]}</Text>
        <Text bold={bold} dimColor={dimColor}> {message}</Text>
      </Box>
      {subtitle && <Text dimColor>{subtitle}</Text>}
    </Box>
  )
}
