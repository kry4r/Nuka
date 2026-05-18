// src/tui/History/SessionList.tsx
//
// B4 — Full-screen browser for past sessions. Mirrors the layout of
// SessionPicker.tsx but adds preview text + a delete affordance. Keys:
//   up/down  navigate
//   enter    resume highlighted session
//   d        delete highlighted session
//   esc      cancel back to main TUI
//
// Stateless on the data side — parent (App.tsx submenu reducer) loads
// the list, passes entries+loading, and re-loads after delete.

import React, { useState, useRef, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'
import stringWidth from 'string-width'
import type { HistoryListEntry, SessionId } from '../../core/session/history/types'
import { defaultPalette as P } from '../theme'
import { useTerminalSize } from '../hooks/useTerminalSize'

function truncateRight(s: string, maxWidth: number): string {
  if (maxWidth <= 0) return ''
  if (stringWidth(s) <= maxWidth) return s
  const budget = maxWidth - 1
  const chars = Array.from(s)
  let width = 0
  let i = 0
  while (i < chars.length) {
    const w = stringWidth(chars[i]!)
    if (width + w > budget) break
    width += w
    i++
  }
  return chars.slice(0, i).join('') + '\u2026'
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`
}

export type SessionListProps = {
  entries: HistoryListEntry[]
  loading: boolean
  onResume: (id: SessionId) => void
  onDelete: (id: SessionId) => void
  onCancel: () => void
}

export function SessionList(props: SessionListProps): React.JSX.Element {
  // All hooks at the top — React requires a stable hook count across renders.
  const [cursor, setCursor] = useState(0)
  const { columns } = useTerminalSize()
  const stateRef = useRef({ cursor, entries: props.entries })
  stateRef.current = { cursor, entries: props.entries }

  const handler = useCallback((input: string, key: import('ink').Key) => {
    const { cursor: c, entries } = stateRef.current
    if (key.upArrow) {
      setCursor(prev => Math.max(0, prev - 1))
    } else if (key.downArrow) {
      setCursor(prev => Math.min(Math.max(0, entries.length - 1), prev + 1))
    } else if (key.return) {
      const sel = entries[c]
      if (sel) props.onResume(sel.id)
    } else if (input === 'd') {
      const sel = entries[c]
      if (sel) props.onDelete(sel.id)
    } else if (key.escape) {
      props.onCancel()
    }
  }, [props])

  useInput(handler)

  if (props.loading) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={P.primary} paddingX={1}>
        <Text color={P.primary} bold>Session history</Text>
        <Text color={P.fg} dimColor>Loading…</Text>
      </Box>
    )
  }

  if (props.entries.length === 0) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={P.primary} paddingX={1}>
        <Text color={P.primary} bold>Session history</Text>
        <Text color={P.fg}>No past sessions.</Text>
        <Text color={P.fg} dimColor>esc to cancel</Text>
      </Box>
    )
  }

  // 4 cols of chrome: border(2) + paddingX(2). Truncate row to fit terminal.
  const rowWidth = Math.max(20, columns - 4)

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={P.primary} paddingX={1}>
      <Text color={P.primary} bold>Session history</Text>
      {props.entries.map((entry, i) => {
        const arrow = i === cursor ? '\u203a' : ' '
        const idShort = entry.id.slice(0, 8)
        const date = formatDate(entry.updatedAt)
        const preview = entry.preview || '(no preview)'
        const row = `${arrow} ${idShort}  ${date}  msgs=${entry.messageCount}  ${preview}`
        return (
          <Text key={entry.id} color={i === cursor ? P.primary : P.fg}>
            {truncateRight(row, rowWidth)}
          </Text>
        )
      })}
      <Text color={P.fg} dimColor>↑↓ navigate · enter resume · d delete · esc cancel</Text>
    </Box>
  )
}
