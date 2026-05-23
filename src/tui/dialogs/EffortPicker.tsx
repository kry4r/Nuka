import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { useColors } from '../../core/theme/context'
import type { Effort } from '../../core/config/schema'

type EffortLevel = NonNullable<Effort>

const LEVELS: ReadonlyArray<{ value: EffortLevel; label: string; hint: string }> = [
  { value: 'low',    label: 'Low',    hint: 'fast, ~1k thinking budget' },
  { value: 'medium', label: 'Medium', hint: 'balanced, ~4k thinking budget' },
  { value: 'high',   label: 'High',   hint: 'deep, ~16k thinking budget' },
]

export type EffortPickerProps = {
  current: Effort
  allowedLevels?: readonly EffortLevel[]
  onSelect: (level: EffortLevel) => void
  onCancel: () => void
}

export function EffortPicker(props: EffortPickerProps): React.JSX.Element {
  const colors = useColors()
  const allowed = props.allowedLevels
    ? new Set<EffortLevel>(props.allowedLevels)
    : null
  const isAllowed = (level: EffortLevel) => !allowed || allowed.has(level)
  const startIdx = (() => {
    const i = LEVELS.findIndex(l => l.value === props.current)
    if (i >= 0 && isAllowed(LEVELS[i]!.value)) return i
    const firstAllowed = LEVELS.findIndex(l => isAllowed(l.value))
    return firstAllowed >= 0 ? firstAllowed : i >= 0 ? i : 1
  })()
  const [cursor, setCursor] = useState(startIdx)
  const hasAvailableLevel = LEVELS.some(l => isAllowed(l.value))
  const moveCursor = (from: number, dir: -1 | 1) => {
    let next = from
    while (true) {
      next += dir
      if (next < 0 || next >= LEVELS.length) return from
      const item = LEVELS[next]
      if (item && isAllowed(item.value)) return next
    }
  }

  useInput((_input, key) => {
    if (key.upArrow) {
      setCursor(c => moveCursor(c, -1))
    } else if (key.downArrow) {
      setCursor(c => moveCursor(c, 1))
    } else if (key.return) {
      const item = LEVELS[cursor]
      if (item && isAllowed(item.value)) props.onSelect(item.value)
    } else if (key.escape) {
      props.onCancel()
    }
  })

  return (
    <Box flexDirection="column">
      {LEVELS.map((it, i) => {
        const selected = i === cursor
        const isCurrent = it.value === props.current
        const disabled = !isAllowed(it.value)
        const sigil = selected ? '›' : ' '
        const mark = isCurrent ? '●' : ' '
        const hint = disabled ? `${it.hint} · unavailable` : it.hint
        return (
          <Text
            key={it.value}
            color={disabled ? colors.fgMuted : selected ? colors.primary : colors.fg}
            bold={selected && !disabled}
          >
            {sigil} [{mark}] {it.label.padEnd(7)} <Text color={colors.fgMuted}>{hint}</Text>
          </Text>
        )
      })}
      <Box marginTop={1}>
        <Text color={colors.fgMuted}>
          {hasAvailableLevel
            ? '↑↓ navigate · ⏎ select · Esc cancel'
            : 'No reasoning effort levels available · Esc cancel'}
        </Text>
      </Box>
    </Box>
  )
}
