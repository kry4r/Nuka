// src/tui/Welcome/notices/EmergencyTip.tsx
//
// Phase C — port of Nuka-Code's EmergencyTip.  Reads the active tip from
// `core/notices/emergencyTip` (returns `null` until a real source is
// wired); when present, renders one indented line below the welcome box.
// `warning` / `error` map onto the theme palette; `dim` (or unset) renders
// dim foreground.

import React, { useMemo } from 'react'
import { Box, Text } from 'ink'
import { defaultPalette as P } from '../../theme'
import { getEmergencyTip, type EmergencyTip as EmergencyTipData } from '../../../core/notices/emergencyTip'

export type EmergencyTipProps = {
  /** Override the tip source (otherwise read from `getEmergencyTip()`). */
  tip?: EmergencyTipData | null
}

export function EmergencyTip(props: EmergencyTipProps): React.JSX.Element | null {
  const tip = useMemo(
    () => (props.tip !== undefined ? props.tip : getEmergencyTip()),
    [props.tip],
  )
  if (!tip || !tip.tip) return null

  const color =
    tip.color === 'warning' ? P.warn :
    tip.color === 'error'   ? P.error :
    undefined
  const dim = color === undefined

  return (
    <Box paddingLeft={2} flexDirection="column">
      <Text color={color} dimColor={dim}>{tip.tip}</Text>
    </Box>
  )
}
