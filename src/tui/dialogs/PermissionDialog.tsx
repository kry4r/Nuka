// src/tui/dialogs/PermissionDialog.tsx
import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { defaultPalette as P } from '../theme'
import type { PermissionCall, PermissionDecision } from '../../core/permission/types'
import type { AnnotationBadge } from '../../core/permission/bridge'

const BADGE_COLORS: Record<AnnotationBadge, string> = {
  'read-only': P.success,
  'destructive': P.error,
  'network': P.warn,
}

export function PermissionDialog(props: {
  call: PermissionCall
  suggestedPattern?: string
  annotationBadges?: AnnotationBadge[]
  onDecide: (d: PermissionDecision) => void
}): React.JSX.Element {
  const isDestructive = props.annotationBadges?.includes('destructive') ?? false
  const isReadOnly = props.annotationBadges?.includes('read-only') ?? false

  // Default cursor: 0 (Allow) for readOnly non-destructive; last option (No/Deny) for destructive
  const options: Array<{ label: string; decide: () => PermissionDecision }> = [
    { label: 'Yes, once', decide: () => ({ allowed: true }) },
    {
      label: `Yes, always for ${props.call.hint} in this session`,
      decide: () => ({ allowed: true, remember: { scope: 'session', hint: props.call.hint } }),
    },
    ...(props.suggestedPattern
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

  const inputSummary = JSON.stringify(props.call.input).slice(0, 120)
  const badges = props.annotationBadges ?? []

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={isDestructive ? P.error : P.warn} paddingX={1}>
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
      <Text color={isDestructive ? P.error : P.warn} bold>{props.call.toolName} · {props.call.hint}</Text>
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
