// src/tui/Submenu/SubmenuList.tsx
//
// Reusable single-column "Claude Code style" cascading menu list.
//
// Pure presentational + key handling. The parent owns the source of truth
// for the items array and the subpage stack: pressing Enter/→/Space delegates
// to a parent-supplied subpage via `onSelect`, and Esc/← bubbles up to the
// parent via `onCancel` so the parent can decide whether to actually pop.
//
// Sliding-window pattern (from SlashCard/CommandList) is used when the list
// would exceed the terminal height.

import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { useColors } from '../../core/theme/context'
import { useTerminalSize } from '../hooks/useTerminalSize'

export type SubmenuListItem = {
  /** Stable key + display text. */
  id: string
  /** Primary label rendered left. */
  label: string
  /** Optional subtitle/description rendered to the right in muted color. */
  description?: string
  /** Optional value summary rendered at far right (e.g. current setting). */
  value?: string
  /** When true, item is rendered with disabled styling and Enter is no-op. */
  disabled?: boolean
}

export type SubmenuListProps = {
  /** Read-only list to render; parent owns the source of truth. */
  items: SubmenuListItem[]
  /** Initial cursor index (default 0). Parent can leave uncontrolled. */
  initialCursor?: number
  /** Whether this list owns keyboard focus. Defaults to true. */
  focused?: boolean
  /** Called when user activates an item (Enter/→/Space). */
  onSelect: (item: SubmenuListItem, index: number) => void
  /** Called when user presses Esc/← to pop back. Parent decides whether to actually close. */
  onCancel?: () => void
  /** Optional footer hint text. If omitted, renders default hint "↑↓ select · ⏎ open · Esc back". */
  footer?: string
}

const DEFAULT_FOOTER = '↑↓ select · ⏎ open · Esc back'

/** Reserve rows for footer + optional windowing indicators + a little padding. */
const ROW_OVERHEAD = 6

export function SubmenuList(props: SubmenuListProps): React.JSX.Element {
  const colors = useColors()
  const focused = props.focused !== false
  const { rows: terminalRows } = useTerminalSize()

  const initial = clamp(props.initialCursor ?? 0, 0, Math.max(0, props.items.length - 1))
  const [cursor, setCursor] = useState<number>(initial)

  // Keep cursor inside bounds when items change length (parent-driven).
  const safeCursor = clamp(cursor, 0, Math.max(0, props.items.length - 1))

  useInput((input, key) => {
    const total = props.items.length
    if (total === 0) {
      if (key.escape || key.leftArrow) props.onCancel?.()
      return
    }
    if (key.upArrow || input === 'k') {
      setCursor(c => Math.max(0, Math.min(c, total - 1) - 1))
      return
    }
    if (key.downArrow || input === 'j') {
      setCursor(c => Math.min(total - 1, Math.min(c, total - 1) + 1))
      return
    }
    if (key.return || key.rightArrow || input === ' ') {
      const idx = clamp(safeCursor, 0, total - 1)
      const item = props.items[idx]
      if (!item) return
      if (item.disabled) return
      props.onSelect(item, idx)
      return
    }
    if (key.escape || key.leftArrow) {
      props.onCancel?.()
      return
    }
  }, { isActive: focused })

  const total = props.items.length

  // Sliding window — only narrow when the list cannot fit.
  const windowSize = Math.max(1, terminalRows - ROW_OVERHEAD)
  const useWindow = total > windowSize
  let start = 0
  let end = total
  if (useWindow) {
    const half = Math.floor(windowSize / 2)
    start = Math.max(0, safeCursor - half)
    end = Math.min(total, start + windowSize)
    if (end - start < windowSize) start = Math.max(0, end - windowSize)
  }
  const showUp = start > 0
  const showDown = end < total
  const slice = props.items.slice(start, end)

  const footer = props.footer ?? DEFAULT_FOOTER

  return (
    <Box flexDirection="column">
      {showUp && (
        <Text color={colors.fgMuted}>  ↑ more above</Text>
      )}
      {slice.map((item, i) => {
        const idx = start + i
        const selected = idx === safeCursor
        const sigil = selected ? '▸' : ' '
        const labelColor = item.disabled
          ? colors.fgFaint
          : selected
            ? colors.fg
            : colors.fg
        const descColor = item.disabled ? colors.fgFaint : colors.fgMuted
        const valueColor = item.disabled ? colors.fgFaint : colors.primary
        return (
          <Box key={item.id} backgroundColor={selected ? colors.primaryDeep : undefined}>
            <Text color={labelColor} bold={selected && !item.disabled}>
              {sigil} {item.label}
            </Text>
            {item.description && (
              <Text color={descColor}>  {item.description}</Text>
            )}
            <Box flexGrow={1} />
            {item.value !== undefined && (
              <Text color={valueColor}>{item.value}</Text>
            )}
          </Box>
        )
      })}
      {showDown && (
        <Text color={colors.fgMuted}>  ↓ more below</Text>
      )}
      <Box marginTop={1}>
        <Text color={colors.fgMuted}>{footer}</Text>
      </Box>
    </Box>
  )
}

function clamp(n: number, lo: number, hi: number): number {
  if (hi < lo) return lo
  return Math.max(lo, Math.min(hi, n))
}
