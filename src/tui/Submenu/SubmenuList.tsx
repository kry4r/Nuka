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

import React, { useEffect, useState } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import { useColors } from '../../core/theme/context'
import { truncateByWidth } from '../../core/stringWidth'

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
  /**
   * Suppress the internal footer row entirely. Useful when the parent
   * frame (e.g. SubmenuFrame) already paints a footer line — avoids
   * duplicate hint text inside and outside the frame.
   */
  omitFooter?: boolean
  /**
   * Available rows for the list body provided by the parent. When set,
   * SubmenuList uses this directly to size its sliding window instead of
   * sniffing the raw terminal height. This lets parent frames whose chrome
   * (border + title + footer) eats rows hand the list an honest budget.
   */
  availableRows?: number
}

const DEFAULT_FOOTER = '↑↓ select · ⏎ open · Esc back'

/**
 * Conservative default reservation of rows when the parent does not supply
 * `availableRows`. Larger than the historical value (which assumed no parent
 * frame chrome) so we err on the side of reserving extra space rather than
 * spilling rows into the parent frame and pushing chrome offscreen.
 */
const DEFAULT_ROW_OVERHEAD = 8

/** Hard floor for the rendered window so we always show a meaningful slice. */
const MIN_WINDOW_SIZE = 3

export function SubmenuList(props: SubmenuListProps): React.JSX.Element {
  const colors = useColors()
  const focused = props.focused !== false
  const { stdout } = useStdout()
  const terminalRows = process.stdout.rows ?? stdout?.rows ?? 24

  const total = props.items.length
  const initial = clamp(props.initialCursor ?? 0, 0, Math.max(0, total - 1))
  const [cursor, setCursor] = useState<number>(initial)

  // Re-clamp the cursor when the items array shrinks underneath us so we
  // never render a phantom selection past the new last index.
  useEffect(() => {
    if (cursor >= total) {
      setCursor(Math.max(0, total - 1))
    }
  }, [total, cursor])

  // Keep cursor inside bounds for this render even before the effect fires.
  const safeCursor = clamp(cursor, 0, Math.max(0, total - 1))

  useInput((input, key) => {
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

  // Sliding window — only narrow when the list cannot fit. When the parent
  // frame supplies an `availableRows` budget we trust it directly; otherwise
  // we fall back to a conservative reservation against the raw terminal
  // height so we don't punch through unknown enclosing chrome.
  const rawWindow =
    typeof props.availableRows === 'number'
      ? props.availableRows
      : terminalRows - DEFAULT_ROW_OVERHEAD
  const windowSize = Math.max(MIN_WINDOW_SIZE, rawWindow)
  const useWindow = total > windowSize
  let start = 0
  let end = total
  if (useWindow) {
    const half = Math.floor(windowSize / 2)
    start = Math.max(0, safeCursor - half)
    end = Math.min(total, start + windowSize)
    if (end - start < windowSize) start = Math.max(0, end - windowSize)
  }
  // Indicators are gated purely on slice coverage so they surface whenever
  // there is content above/below — independent of whether windowing was
  // formally engaged on this render.
  const showUp = start > 0
  const showDown = end < total
  const slice = props.items.slice(start, end)

  const footer = props.footer ?? DEFAULT_FOOTER

  // Width budget for each row. Parent frame chrome (border + paddingX) is
  // approximately 4 cols; we reserve a bit more so descriptions never
  // collide with the value column.
  const columns = process.stdout.columns ?? stdout?.columns ?? 80
  const FRAME_CHROME_COLS = 6
  const innerWidth = Math.max(20, columns - FRAME_CHROME_COLS)
  const LABEL_WIDTH = 14
  const VALUE_WIDTH = 24
  const VALUE_MAX_CHARS = 20

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
        const bg = selected ? colors.primaryDeep : undefined
        const valueText =
          item.value !== undefined ? truncateValue(item.value, VALUE_MAX_CHARS) : undefined
        return (
          <Box key={item.id} width={innerWidth} backgroundColor={bg}>
            <Box width={LABEL_WIDTH + 2} flexShrink={0}>
              <Text color={labelColor} bold={selected && !item.disabled} wrap="truncate-end">
                {sigil} {item.label}
              </Text>
            </Box>
            <Box flexGrow={1} flexShrink={1}>
              {item.description ? (
                <Text color={descColor} wrap="truncate-end">  {item.description}</Text>
              ) : (
                <Text> </Text>
              )}
            </Box>
            <Box width={VALUE_WIDTH} flexShrink={0} justifyContent="flex-end">
              {valueText !== undefined ? (
                <Text color={valueColor} wrap="truncate-end">{valueText}</Text>
              ) : (
                <Text> </Text>
              )}
            </Box>
          </Box>
        )
      })}
      {showDown && (
        <Text color={colors.fgMuted}>  ↓ more below</Text>
      )}
      {!props.omitFooter && (
        <Box marginTop={1}>
          <Text color={colors.fgMuted}>{footer}</Text>
        </Box>
      )}
    </Box>
  )
}

function clamp(n: number, lo: number, hi: number): number {
  if (hi < lo) return lo
  return Math.max(lo, Math.min(hi, n))
}

function truncateValue(s: string, max: number): string {
  return truncateByWidth(s, max)
}
