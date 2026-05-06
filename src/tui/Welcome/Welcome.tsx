// src/tui/Welcome/Welcome.tsx
//
// Phase A — port of Nuka-Code's LogoV2:
//   compact (cols < 80): centered single-column bordered box "NUKA",
//     welcome line + Clawd avocado + model/cwd/branch lines.
//   normal/wide (cols ≥ 80): bordered outer box with title "NUKA v<x>".
//     Left column: welcome (top), Clawd (middle), model/cwd lines (bottom),
//     space-between. Right column: Updates + Recent panels (Phase B will
//     migrate these to FeedColumn).
//
// Bug fixes vs. prior 3D ANSI Shadow logo:
//   - Locale-stable glyphs: braille (U+28xx) is EAW Neutral, not Ambiguous,
//     so CJK terminals can't double-render it into the wrap zone.
//   - Vertical floor sized to CLAWD_HEIGHT + 4 so the avocado isn't clipped.

import React from 'react'
import { Box, Text } from 'ink'
import stringWidth from 'string-width'
import { useTerminalSize } from '../hooks/useTerminalSize'
import { defaultPalette as P } from '../theme'
import { Clawd, CLAWD_HEIGHT, CLAWD_WIDTH } from './Clawd'
import { BorderedBox } from '../design-system/BorderedBox'
import {
  calculateLayoutDimensions,
  calculateOptimalLeftWidth,
  formatWelcomeMessage,
  getLayoutMode,
  truncatePath,
} from './layout'
import { FeedColumn } from './FeedColumn'
import { createRecentFeed, createUpdatesFeed } from './feedConfigs'
import { EmergencyTip } from './notices/EmergencyTip'
import type { EmergencyTip as EmergencyTipData } from '../../core/notices/emergencyTip'
import type { UpdateEntry } from '../../core/updates/load'
import type { RecentEntry } from '../../core/session/recent'

const LEFT_PANEL_MAX_WIDTH = 50

export type WelcomeProps = {
  cwd: string
  gitBranch: { branch: string; dirty: boolean } | null
  model: string
  version: string
  updates?: UpdateEntry[]
  recent?: RecentEntry[]
  /** Override terminal columns (for tests). */
  columnsOverride?: number
  /** Override terminal rows (for tests). */
  rowsOverride?: number
  /** Override username (otherwise omitted; Phase B may resolve this from settings). */
  username?: string
  /** Phase D2 — pre-resolved EmergencyTip data from config.notices.emergency. */
  emergencyTip?: EmergencyTipData | null
}

export function Welcome(props: WelcomeProps): React.JSX.Element {
  const { cwd, gitBranch, model, version, updates = [], recent = [], username, emergencyTip = null } = props
  const { columns: termCols } = useTerminalSize()
  const columns = props.columnsOverride ?? termCols

  const layoutMode = getLayoutMode(columns)
  const branchSegment = gitBranch
    ? `${gitBranch.branch}${gitBranch.dirty ? ' *' : ''}`
    : '(not a git repo)'
  const modelLine = model.trim() ? model : '<no provider>'
  const tipNode = (
    <Text color={P.accentInfo}>
      Type <Text color={P.primary}>/</Text> for commands
    </Text>
  )

  if (layoutMode === 'compact') {
    let welcomeMessage = formatWelcomeMessage(username ?? null)
    if (stringWidth(welcomeMessage) > columns - 4) {
      welcomeMessage = formatWelcomeMessage(null)
    }
    const cwdAvailableWidth = Math.max(columns - 4, 10)
    const truncatedCwd = truncatePath(cwd, cwdAvailableWidth)
    const compactWidth = Math.min(columns, Math.max(CLAWD_WIDTH + 4, 28))

    return (
      <Box flexDirection="column">
        <BorderedBox
          title=" NUKA "
          titleColor={P.primary}
          align="start"
          offset={1}
          borderColor={P.primary}
          width={compactWidth}
        >
          <Box flexDirection="column" alignItems="center" paddingX={1} paddingY={1}>
            <Text bold>{welcomeMessage}</Text>
            <Box marginY={1}>
              <Clawd />
            </Box>
            <Text color={P.fgMuted}>{modelLine}</Text>
            <Text color={P.fgMuted}>{truncatedCwd}</Text>
            <Text color={P.fgMuted}>{branchSegment}</Text>
            <Box marginTop={1}>{tipNode}</Box>
          </Box>
        </BorderedBox>
        <EmergencyTip tip={emergencyTip} />
      </Box>
    )
  }

  // normal / wide: two-column bordered outer box.
  const welcomeMessage = formatWelcomeMessage(username ?? null)
  const cwdLine = truncatePath(cwd, LEFT_PANEL_MAX_WIDTH)
  const optimalLeftWidth = Math.max(
    calculateOptimalLeftWidth(welcomeMessage, cwdLine, modelLine),
    CLAWD_WIDTH + 4,
  )
  const { leftWidth, rightWidth, totalWidth } = calculateLayoutDimensions(
    columns,
    layoutMode,
    optimalLeftWidth,
  )

  const titleNode = (
    <Text>
      <Text color={P.primary} bold>NUKA</Text>
      <Text color={P.fgMuted}> v{version}</Text>
    </Text>
  )

  const heroMinHeight = Math.max(CLAWD_HEIGHT + 4, 11)

  return (
    <Box flexDirection="column">
      <BorderedBox
        titleNode={titleNode}
        align="start"
        offset={3}
        borderColor={P.primary}
        width={totalWidth}
      >
        <Box flexDirection="row" paddingX={1} width={totalWidth - 2}>
          {/* Left: welcome (top) → Clawd (mid) → model/cwd (bottom). */}
          <Box
            flexDirection="column"
            width={leftWidth}
            flexShrink={0}
            justifyContent="space-between"
            alignItems="center"
            minHeight={heroMinHeight}
          >
            <Box marginTop={1}>
              <Text bold>{welcomeMessage}</Text>
            </Box>
            <Clawd />
            <Box flexDirection="column" alignItems="center">
              <Text color={P.fgMuted}>{modelLine}</Text>
              <Text color={P.fgMuted}>{cwdLine}</Text>
              <Text color={P.fgMuted}>{branchSegment}</Text>
              <Box marginTop={1}>{tipNode}</Box>
            </Box>
          </Box>
          {/* Vertical divider — borderRight only, no top/bottom/left edges. */}
          <Box
            borderStyle="single"
            borderColor={P.fgMuted}
            borderDimColor
            borderTop={false}
            borderBottom={false}
            borderLeft={false}
            marginX={1}
          />
          {/* Right column — FeedColumn (Phase B): Updates + Recent + future feeds. */}
          <Box flexDirection="column" width={rightWidth} flexShrink={1}>
            <FeedColumn
              feeds={[createUpdatesFeed(updates), createRecentFeed(recent)]}
              maxWidth={rightWidth}
            />
          </Box>
        </Box>
      </BorderedBox>
      <EmergencyTip tip={emergencyTip} />
    </Box>
  )
}
