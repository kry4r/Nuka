// src/tui/StatusBar/HintLine.tsx
import React from 'react'
import { Text } from 'ink'
import { defaultPalette as P } from '../theme'

export type HintMode = 'idle' | 'running' | 'awaiting-user' | 'primed-quit'

export function HintLine({ mode }: { mode: HintMode }): React.JSX.Element {
  const map: Record<HintMode, string> = {
    'idle': '? shortcuts · ⏎ send',
    'running': 'esc cancel · ⏎ queue',
    'awaiting-user': '↑↓ select · ⏎ confirm · esc reject',
    'primed-quit': 'esc×2 to quit',
  }
  return <Text color={P.muted}>{map[mode]}</Text>
}
