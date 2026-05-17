// src/tui/Recap/AwaySummaryCard.tsx — Phase 14c §5.3
import * as React from 'react'
import { Box, Text } from 'ink'
import { formatDuration } from '../../core/duration/duration'

// Iter NNNN — the optional `idleMs` prop is rendered as a leading
// "Away N min" badge so the banner gives the user an immediate sense
// of how long they were gone before they parse the recap sentence.
// The duration is humanised via `formatDuration({precision:1, subSecondPrecision:false})`
// so "47 min" reads as "47m" — matches Nuka's pretty-duration default.
//
// NOTE: The component had a "[esc] dismiss" hint but no useInput handler
// hooked up — pressing Esc never called onDismiss. Per spec choice (b)
// (P2 #44) we remove the misleading line so the footer stops promising
// behavior the component doesn't deliver. The `onDismiss` prop is kept
// for future use (no-op until a caller wires up its own dismissal flow);
// Iter NNNN's TUI wiring relies on App's `onUserInput` callback to
// invoke `dismiss()` from `useAwayRecap`, NOT on Esc keystrokes inside
// this component.
export type AwaySummaryCardProps = {
  text: string
  onDismiss: () => void
  /**
   * Iter NNNN — idle window that triggered the recap, in ms. When
   * provided, the banner renders a `[← Away 47m]` prefix line. Optional
   * so existing callers (no idleMs context) continue to work unchanged.
   */
  idleMs?: number
}

export function AwaySummaryCard(p: AwaySummaryCardProps): React.ReactNode {
  void p.onDismiss
  const durationLabel =
    typeof p.idleMs === 'number' && Number.isFinite(p.idleMs) && p.idleMs > 0
      ? formatDuration(p.idleMs, { precision: 1, subSecondPrecision: false })
      : null
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      {durationLabel !== null ? (
        <Text dimColor>※ While you were away · {durationLabel}</Text>
      ) : (
        <Text dimColor>※ While you were away</Text>
      )}
      <Text>{p.text}</Text>
    </Box>
  )
}

