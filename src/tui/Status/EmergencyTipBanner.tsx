// src/tui/Status/EmergencyTipBanner.tsx
//
// Persistent banner for the EmergencyTip notice (config.notices.emergency).
//
// Background: the same payload was previously rendered inside the Welcome
// hero (see the now-removed `src/tui/Welcome/notices/EmergencyTip.tsx`).
// Once the first message landed, Welcome flipped into Messages' `<Static>`
// stream and the tip scrolled out of view alongside it — exactly the
// failure mode the notice was supposed to guard against. This mirrors
// the CronMissedBanner fix from Turn 13.
//
// Visual contract (preserves the tri-color semantics of the legacy
// `Welcome/notices/EmergencyTip.tsx`):
//   - `warning` → P.warn border + warn text
//   - `error`   → P.error border + error text
//   - `dim`/unset → fgMuted border + dimColor text
// Rounded border + paddingX={1} + flexShrink={0} matches CronMissedBanner
// so the two BOTTOM-slot rows stack cleanly.
//
// Lifecycle / dismiss policy is owned by `App.tsx` — this component is a
// pure render of `(tip, dismissed) -> JSX | null`.

import React from 'react'
import { Box, Text } from 'ink'
import { defaultPalette as P } from '../theme'
import type { EmergencyTip as EmergencyTipData } from '../../core/notices/emergencyTip'

export type EmergencyTipBannerProps = {
  /**
   * Tip payload from `getEmergencyTip()` / `config.notices.emergency`.
   * `null`/omitted suppresses the slot entirely.
   */
  tip?: EmergencyTipData | null
  /**
   * When true, the banner returns `null` regardless of `tip`. Dismiss
   * state is owned by `App.tsx` (auto-dismiss after the first user/
   * assistant turn lands) so this component stays presentation-only.
   */
  dismissed?: boolean
}

export function EmergencyTipBanner(
  props: EmergencyTipBannerProps,
): React.JSX.Element | null {
  const tip = props.tip ?? null
  if (!tip || !tip.tip) return null
  if (props.dismissed === true) return null

  const textColor =
    tip.color === 'warning' ? P.warn :
    tip.color === 'error'   ? P.error :
    undefined
  const borderColor =
    tip.color === 'warning' ? P.warn :
    tip.color === 'error'   ? P.error :
    P.fgMuted
  const dim = textColor === undefined

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={borderColor}
      paddingX={1}
      flexShrink={0}
    >
      <Text color={textColor} dimColor={dim}>{tip.tip}</Text>
    </Box>
  )
}
