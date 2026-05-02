// src/tui/Welcome/Welcome.tsx
//
// Phase 13 M2 — Welcome screen redesign with 2:1 left/right split.
//
// Layout (wide terminals, ≥100 cols):
//   ┌─────────────────────────┐  ┌───────────┐
//   │  Logo + hero (left)     │  │  Updates  │
//   │  flexGrow=2             │  │           │
//   │                         │  ├───────────┤
//   │                         │  │  Recent   │
//   │                         │  │           │
//   └─────────────────────────┘  └───────────┘
//
// Narrow terminals (<100 cols): right column hidden, Welcome takes 100%.
//
// Render order inside left frame (§4.1 spec):
//   Logo → blank → NUKA wordmark → blank → <model> · <cwd> <branch>
//   (no labels) → blank → "Type / for commands"

import React from 'react'
import { Box, Text } from 'ink'
import { Logo } from './Logo'
import { UpdatesPanel } from './UpdatesPanel'
import { RecentPanel } from './RecentPanel'
import { useTerminalSize } from '../hooks/useTerminalSize'
import { defaultPalette as P } from '../theme'
import type { UpdateEntry } from '../../core/updates/load'
import type { RecentEntry } from '../../core/session/recent'

// ≈ rows consumed by Tasks + Prompt + Status zones
const RESERVED_ROWS = 18
// Hero never grows beyond this — keeps the avocado from floating in
// a cavernous empty box on tall terminals.
const HERO_MAX_HEIGHT = 12
const NARROW_THRESHOLD = 100

export type WelcomeProps = {
  cwd: string
  gitBranch: { branch: string; dirty: boolean } | null
  model: string
  version: string
  tip: string
  updates?: UpdateEntry[]
  recent?: RecentEntry[]
  /** Override terminal columns (for tests). */
  columnsOverride?: number
  /** Override terminal rows (for tests). */
  rowsOverride?: number
}

export function Welcome(props: WelcomeProps): React.JSX.Element {
  const { cwd, gitBranch, model, updates = [], recent = [] } = props
  const { columns: termCols, rows: termRows } = useTerminalSize()
  const columns = props.columnsOverride ?? termCols
  const rows = props.rowsOverride ?? termRows

  const narrow = columns < NARROW_THRESHOLD

  // Hero takes (rows − reserved-bottom-zones) but never grows past a hard
  // ceiling — so a tall terminal doesn't produce a giant empty frame around
  // the icon. Floor stays at 5 to match the original short-terminal layout.
  const contentHeight = Math.min(HERO_MAX_HEIGHT, Math.max(5, rows - RESERVED_ROWS))

  // Branch display
  const git = gitBranch
    ? `${gitBranch.branch}${gitBranch.dirty ? ' *' : ''}`
    : '(not a git repo)'

  // Truncate cwd from the left so the leaf stays visible
  const cwdDisplay = cwd.length > 40 ? '\u2026' + cwd.slice(cwd.length - 39) : cwd

  const heroContent = (
    <Box flexDirection="column" alignItems="center" justifyContent="center" height={contentHeight}>
      <Box justifyContent="center">
        <Logo compact />
      </Box>
      <Box justifyContent="center">
        <Text color={P.primary} bold>NUKA</Text>
      </Box>
      <Box justifyContent="center">
        <Text color={P.fgMuted}>
          {model}
          {' · '}
          {cwdDisplay}
          {' '}
          {git}
        </Text>
      </Box>
      <Box justifyContent="center">
        <Text color={P.accentInfo}>Type <Text color={P.primary}>/</Text> for commands</Text>
      </Box>
    </Box>
  )

  if (narrow) {
    // Narrow: welcome takes 100% width, no right column.
    // Bug fix: dropped outer flexGrow=1 so the frame hugs its content
    // instead of inflating to fill the whole conversation zone.
    return (
      <Box
        borderStyle="round"
        borderColor={P.fgMuted}
        flexDirection="column"
      >
        {heroContent}
      </Box>
    )
  }

  // Wide: 2:1 split.
  // Bug fix: dropped outer-row flexGrow=1 so the row hugs its content
  // height. The inner flexGrow={2}/flexGrow={1} still govern the left/right
  // width split.
  // Bug fix #8: cap the right rail at the same `contentHeight` the hero
  // uses so the Updates/Recent panels can't inflate past the hero on tall
  // terminals (200×50, 80×100). The left frame is `contentHeight + 2` rows
  // (border adds 2); using `contentHeight` here makes the right column 2
  // rows shorter than the left, which is intentional per spec — the right
  // column hugs its hero-equivalent area.
  return (
    <Box flexDirection="row">
      {/* Left: framed Welcome panel, flexGrow=2 */}
      <Box
        flexGrow={2}
        borderStyle="round"
        borderColor={P.fgMuted}
        flexDirection="column"
      >
        {heroContent}
      </Box>

      {/* Right column: Updates stacked above Recent, flexGrow=1, min 24 cols.
          Hard-capped at contentHeight (no flexGrow on the inner panels) so
          the right rail doesn't leak past the hero. flexShrink=0 keeps the
          inner panels from collapsing below their natural content. */}
      <Box
        flexGrow={1}
        flexShrink={0}
        minWidth={24}
        height={contentHeight}
        flexDirection="column"
      >
        <UpdatesPanel updates={updates} />
        <RecentPanel recent={recent} />
      </Box>
    </Box>
  )
}
