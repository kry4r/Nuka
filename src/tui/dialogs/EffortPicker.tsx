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
  onSelect: (level: EffortLevel) => void
  onCancel: () => void
}

export function EffortPicker(props: EffortPickerProps): React.JSX.Element {
  const colors = useColors()
  const startIdx = (() => {
    const i = LEVELS.findIndex(l => l.value === props.current)
    return i >= 0 ? i : 1
  })()
  const [cursor, setCursor] = useState(startIdx)

  useInput((_input, key) => {
    if (key.upArrow) {
      setCursor(c => Math.max(0, c - 1))
    } else if (key.downArrow) {
      setCursor(c => Math.min(LEVELS.length - 1, c + 1))
    } else if (key.return) {
      const item = LEVELS[cursor]
      if (item) props.onSelect(item.value)
    } else if (key.escape) {
      props.onCancel()
    }
  })

  return (
    <Box flexDirection="column">
      {LEVELS.map((it, i) => {
        const selected = i === cursor
        const isCurrent = it.value === props.current
        const sigil = selected ? '›' : ' '
        const mark = isCurrent ? '●' : ' '
        return (
          <Text
            key={it.value}
            color={selected ? colors.primary : colors.fg}
            bold={selected}
          >
            {sigil} [{mark}] {it.label.padEnd(7)} <Text color={colors.fgMuted}>{it.hint}</Text>
          </Text>
        )
      })}
      <Box marginTop={1}>
        <Text color={colors.fgMuted}>↑↓ navigate · ⏎ select · Esc cancel</Text>
      </Box>
    </Box>
  )
}
