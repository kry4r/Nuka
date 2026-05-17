// src/tui/Status/CronMissedBanner.tsx
//
// Persistent banner for the "missed cron tasks" notice.
//
// Background: the same payload was previously rendered inside the Welcome
// hero (see `src/tui/Welcome/notices/CronMissedNotice.tsx`). Once the first
// message landed, Welcome flipped into Messages' `<Static>` stream and the
// notice scrolled out of view alongside it — exactly the failure mode the
// notice was supposed to guard against (a user sees missed tasks for half a
// second, then types and never sees the warning again).
//
// This component lives in the BOTTOM slot (next to `AwaySummaryCard`) so it
// stays visible across renders until the dismiss condition is met. It is
// intentionally a separate component from `CronMissedNotice` because the
// hero version had different padding/container semantics (no top margin,
// docked inside the Welcome column); the BOTTOM-slot variant is a free
// row above the prompt and needs a small vertical breathing space.
//
// Visual contract:
//   - warning-coloured rounded border (matches the prior Welcome notice)
//   - single-line text from `formatCronMissedNotice`
//   - dim hint footer reminding the user the slot dismisses automatically
//
// Lifecycle / dismiss policy is owned by `App.tsx` — this component is a
// pure render of `(notice, dismissed) -> JSX | null`.

import React from 'react'
import { Box, Text } from 'ink'
import { defaultPalette as P } from '../theme'
import type { CronMissedNotice as CronMissedNoticeData } from '../../core/notices/cronMissed'

export type CronMissedBannerProps = {
  /**
   * Notice payload from `formatCronMissedNotice`. `null`/omitted suppresses
   * the slot entirely. Matches the contract on the (now-removed) Welcome
   * variant so callers can swap with no payload changes.
   */
  notice?: CronMissedNoticeData | null
  /**
   * When true, the banner returns `null` regardless of `notice`. The
   * dismiss state is owned by `App.tsx` (auto-dismiss after the first
   * user/assistant turn lands) so this component stays presentation-only.
   */
  dismissed?: boolean
}

export function CronMissedBanner(
  props: CronMissedBannerProps,
): React.JSX.Element | null {
  const notice = props.notice ?? null
  if (!notice) return null
  if (props.dismissed === true) return null
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={P.warn}
      paddingX={1}
      flexShrink={0}
    >
      <Text color={P.warn}>{notice.text}</Text>
    </Box>
  )
}
