// src/tui/Status/CostBanner.tsx
//
// Real-time cost display, BOTTOM-slot row beside CronMissedBanner /
// EmergencyTipBanner. Visibility is gated by `enabled` (App.tsx wires this
// to `isCostDisplayEnabled()` so default behaviour is unchanged).
//
// Visual contract mirrors the sibling banners:
//   - rounded border in fgMuted (accent uses warn/error semantics already)
//   - paddingX={1}
//   - flexShrink={0} so vertical layout never squeezes the row
//   - returns null when there's nothing to show (no tracker, empty session,
//     env gate off) so the slot collapses cleanly.

import React from 'react'
import { Box, Text } from 'ink'
import { defaultPalette as P } from '../theme'
import type { CostTracker } from '../../core/cost/tracker'
import { formatBannerLine } from '../../core/cost/costHook'

export type CostBannerProps = {
  /**
   * Env-opt-in gate. Owned by App.tsx (resolves
   * `isCostDisplayEnabled()` once at boot). When false the component
   * returns null regardless of tracker contents.
   */
  enabled: boolean
  /**
   * Shared CostTracker — same instance the agent loop writes into. When
   * omitted (e.g. tests without a tracker) the banner is invisible.
   */
  tracker?: CostTracker
  /** Current session id; used to scope the displayed totals. */
  sessionId: string
  /** Current model id; used to resolve pricing for USD display. */
  model: string
}

export function CostBanner(props: CostBannerProps): React.JSX.Element | null {
  if (!props.enabled) return null
  if (!props.tracker) return null
  const line = formatBannerLine(props.tracker, props.sessionId, props.model)
  if (!line) return null
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={P.fgMuted}
      paddingX={1}
      flexShrink={0}
    >
      <Text color={P.fgMuted}>{line}</Text>
    </Box>
  )
}
