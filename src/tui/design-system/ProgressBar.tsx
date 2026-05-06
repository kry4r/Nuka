// src/tui/design-system/ProgressBar.tsx
//
// Phase D3 — Sub-pixel-fill progress bar ported from Nuka-Code's ProgressBar.
// Renders a single-line filled bar of a given character `width` for the input
// `ratio` (clamped to [0, 1]).  Uses the BLOCKS table to draw a partial-fill
// boundary character between the whole-filled `#` chars and the empty trail.
//
// Adaptation: `fillColor`/`emptyColor` accept any hex/string ink understands
// (including theme palette tokens) — Nuka-Code's `keyof Theme` constraint is
// dropped to keep the primitive reusable across pipelines and palettes.

import React from 'react'
import { Text } from 'ink'
import { defaultPalette as P } from '../theme'

export type ProgressBarProps = {
  /** Progress fraction, clamped to [0, 1]. */
  ratio: number
  /** Bar width in characters. */
  width: number
  /** Color for filled portion (default: theme primary). */
  fillColor?: string
  /** Background color for empty portion (default: theme fgFaint). */
  emptyColor?: string
}

const BLOCKS: readonly string[] = [' ', '.', ':', '-', '=', '+', '*', '#', '#']

export function ProgressBar(props: ProgressBarProps): React.JSX.Element {
  const { ratio: input, width, fillColor = P.primary, emptyColor = P.fgFaint } = props
  const ratio = Math.min(1, Math.max(0, input))
  const whole = Math.floor(ratio * width)
  const segments: string[] = [BLOCKS[BLOCKS.length - 1]!.repeat(whole)]
  if (whole < width) {
    const remainder = ratio * width - whole
    const middle = Math.floor(remainder * BLOCKS.length)
    segments.push(BLOCKS[middle]!)
    const empty = width - whole - 1
    if (empty > 0) {
      segments.push(BLOCKS[0]!.repeat(empty))
    }
  }
  return <Text color={fillColor} backgroundColor={emptyColor}>{segments.join('')}</Text>
}
