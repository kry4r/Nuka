// src/tui/design-system/Ratchet.tsx
//
// Phase D3 — Height stabilizer ported from Nuka-Code's Ratchet.  Locks the
// outer Box's `minHeight` to the tallest height the children have ever
// rendered, preventing collapse/jitter when content shrinks (e.g. dialog
// forms with optional fields, sub-screens with disappearing rows).
//
// Differences vs. Nuka-Code:
//   - Skips `useTerminalViewport` (lives in Nuka-Code's ink fork).
//     `lock='offscreen'` is therefore unsupported and falls back to 'always'
//     with a one-time console.warn.
//   - Caps minHeight at the current terminal row count so a Ratchet can
//     never overflow the screen.
//
// useLayoutEffect runs every render (no dep array) — that's intentional, it's
// how the ratchet catches every height change.

import React, { useLayoutEffect, useRef, useState } from 'react'
import { Box, type DOMElement, measureElement } from 'ink'
import { useTerminalSize } from '../hooks/useTerminalSize'

export type RatchetProps = {
  children: React.ReactNode
  /**
   * `always` (default): minHeight always tracks the max observed child height.
   * `offscreen`: lock only when the Ratchet is scrolled out of view — requires
   * a viewport hook Nuka does not yet ship; falls back to `always` with a
   * one-time console warning.
   */
  lock?: 'always' | 'offscreen'
}

let warnedOffscreen = false

export function Ratchet({ children, lock = 'always' }: RatchetProps): React.JSX.Element {
  if (lock === 'offscreen' && !warnedOffscreen) {
    warnedOffscreen = true
    // eslint-disable-next-line no-console
    console.warn('[nuka] Ratchet lock="offscreen" is unsupported (no viewport hook); using "always".')
  }
  const { rows } = useTerminalSize()
  const innerRef = useRef<DOMElement | null>(null)
  const maxHeight = useRef(0)
  const [minHeight, setMinHeight] = useState(0)
  useLayoutEffect(() => {
    if (!innerRef.current) return
    const { height } = measureElement(innerRef.current)
    if (height > maxHeight.current) {
      maxHeight.current = Math.min(height, rows)
      setMinHeight(maxHeight.current)
    }
  })
  return (
    <Box minHeight={minHeight || undefined}>
      <Box ref={innerRef} flexDirection="column">{children}</Box>
    </Box>
  )
}
