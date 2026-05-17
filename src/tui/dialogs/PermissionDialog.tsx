// src/tui/dialogs/PermissionDialog.tsx
import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { defaultPalette as P } from '../theme'
import { useTerminalSize } from '../hooks/useTerminalSize'
import type { PermissionCall, PermissionDecision } from '../../core/permission/types'
import type { AnnotationBadge, PermissionVariant } from '../../core/permission/bridge'

const BADGE_COLORS: Record<AnnotationBadge, string> = {
  'read-only': P.success,
  'destructive': P.error,
  'network': P.warn,
}

export function PermissionDialog(props: {
  call: PermissionCall
  suggestedPattern?: string
  annotationBadges?: AnnotationBadge[]
  /**
   * Optional UX variant. `'planMode'` paints a bespoke meta-operation
   * dialog matching the `[PLAN MODE]` StatusPanel badge (Iter DDDD).
   * Defaults to the generic per-tool prompt.
   */
  variant?: PermissionVariant
  onDecide: (d: PermissionDecision) => void
}): React.JSX.Element {
  const isDestructive = props.annotationBadges?.includes('destructive') ?? false
  const isReadOnly = props.annotationBadges?.includes('read-only') ?? false
  const isPlanMode = props.variant === 'planMode'
  const { columns } = useTerminalSize()
  // On narrow terminals the full pattern row competes for space with the
  // input summary; drop it so the dialog fits without wrapping.
  const isNarrow = columns < 80
  const includePattern = !!props.suggestedPattern && !isNarrow

  // Default cursor: 0 (Allow) for readOnly non-destructive; last option (No/Deny) for destructive.
  // Plan-mode variant uses a stripped 2-option layout (Yes / Cancel) — see comment below.
  const options: Array<{ label: string; decide: () => PermissionDecision }> = isPlanMode
    ? [
        // Plan-mode is a session-scoped state change, not a per-call
        // permission grant. A `remember: { scope: 'session', hint: 'ask' }`
        // rule would silently auto-flip the user into plan mode on every
        // future `EnterPlanMode` request — surprising and unwanted. So
        // we offer just Yes (once) / Cancel here.
        {
          label: 'Yes, enter Plan Mode',
          decide: () => ({ allowed: true }),
        },
        {
          label: 'Cancel',
          decide: () => ({ allowed: false, reason: 'user denied' }),
        },
      ]
    : [
        { label: 'Yes, once', decide: () => ({ allowed: true }) },
        {
          label: `Yes, always for ${props.call.hint} in this session`,
          decide: () => ({ allowed: true, remember: { scope: 'session', hint: props.call.hint } }),
        },
        ...(includePattern
          ? [{
              label: `Yes, always for ${props.suggestedPattern}`,
              decide: () => ({
                allowed: true,
                remember: { scope: 'pattern' as const, hint: props.call.hint, pattern: props.suggestedPattern! },
              }),
            }]
          : []),
        { label: 'No', decide: () => ({ allowed: false, reason: 'user denied' }) },
      ]

  // For planMode the safe default is the affirmative (user invoked
  // /plan-style flow indirectly — typically wants to proceed). For
  // destructive ops we still default to Deny.
  const defaultCursor = isDestructive ? options.length - 1 : 0
  const [cursor, setCursor] = useState(defaultCursor)

  useInput((input, key) => {
    if (key.upArrow) setCursor(c => Math.max(0, c - 1))
    else if (key.downArrow) setCursor(c => Math.min(options.length - 1, c + 1))
    else if (key.return) {
      const opt = options[cursor]!
      props.onDecide(opt.decide())
    }
    else if (key.escape) props.onDecide({ allowed: false, reason: 'escape' })
    else if (/^[1-9]$/.test(input)) {
      const n = Number(input) - 1
      if (n < options.length) {
        const opt = options[n]!
        props.onDecide(opt.decide())
      }
    }
  })

  // Was hardcoded slice(0, 120). Use the live terminal width so wide TTYs
  // show the full call and narrow ones don't wrap. 4 cols of chrome.
  const summaryWidth = Math.max(20, columns - 4)
  const summaryRaw = JSON.stringify(props.call.input)
  const inputSummary = summaryRaw.length > summaryWidth
    ? summaryRaw.slice(0, summaryWidth - 1) + '…'
    : summaryRaw
  const badges = props.annotationBadges ?? []

  // Border / accent colour: planMode borrows the same `warn` orange that
  // the StatusPanel [PLAN MODE] badge (Iter DDDD) uses, so the consent
  // gate and the resulting status badge visually agree.
  const borderColor = isDestructive ? P.error : P.warn
  const accentColor = isDestructive ? P.error : P.warn

  if (isPlanMode) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={borderColor} paddingX={1}>
        {/* Header: bespoke "Enter Plan Mode" banner. Mirrors the
            [PLAN MODE] StatusPanel badge so the user recognises the
            state they're about to enter. */}
        <Box>
          <Text color={accentColor} bold>[PLAN MODE] </Text>
          <Text bold>Enter Plan Mode?</Text>
        </Box>
        {/* Subtitle: explains the consequence in one breath. */}
        <Text color={P.fgMuted}>
          Read-only tools only — writes / exec are blocked until you approve a plan.
        </Text>
        <Box height={1} />
        {options.map((o, i) => (
          <Text key={o.label} color={i === cursor ? P.primary : P.fg}>
            {i === cursor ? '›' : ' '} [{i + 1}] {o.label}
          </Text>
        ))}
        <Box height={1} />
        <Text color={P.fgMuted}>↑↓ select · ⏎ confirm · esc cancel</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={borderColor} paddingX={1}>
      {isDestructive && (
        <Box>
          <Text color={P.error} bold>⚠ WARNING: destructive operation — review carefully</Text>
        </Box>
      )}
      {badges.length > 0 && (
        <Box>
          {badges.map(badge => (
            <Text key={badge} color={BADGE_COLORS[badge]}>[{badge}] </Text>
          ))}
        </Box>
      )}
      <Text color={accentColor} bold>{props.call.toolName} · {props.call.hint}</Text>
      <Text color={P.fgMuted}>{inputSummary}</Text>
      <Box height={1} />
      {options.map((o, i) => (
        <Text key={o.label} color={i === cursor ? P.primary : P.fg}>
          {i === cursor ? '›' : ' '} [{i + 1}] {o.label}
        </Text>
      ))}
      <Box height={1} />
      <Text color={P.fgMuted}>↑↓ select · ⏎ confirm · esc reject</Text>
    </Box>
  )
}
