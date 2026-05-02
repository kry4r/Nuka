// src/tui/dialogs/SessionPicker.tsx
import React, { useState, useRef, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'
import stringWidth from 'string-width'
import type { SessionMeta } from '../../core/session/store'
import { defaultPalette as P } from '../theme'
import { useTerminalSize } from '../hooks/useTerminalSize'

/** Middle-truncate: keeps head + tail with "…" in the middle. */
function middleTruncate(s: string, maxWidth: number): string {
  if (maxWidth <= 0) return ''
  if (stringWidth(s) <= maxWidth) return s
  const budget = Math.max(1, maxWidth - 1)
  const half = Math.floor(budget / 2)
  const chars = Array.from(s)
  // Build head from left.
  let headW = 0
  let h = 0
  while (h < chars.length) {
    const w = stringWidth(chars[h]!)
    if (headW + w > half) break
    headW += w
    h++
  }
  // Build tail from right.
  let tailW = 0
  let t = chars.length
  while (t > h) {
    const w = stringWidth(chars[t - 1]!)
    if (tailW + w > budget - headW) break
    tailW += w
    t--
  }
  return chars.slice(0, h).join('') + '…' + chars.slice(t).join('')
}

/** Right-truncate string s to fit maxWidth columns. */
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
  return chars.slice(0, i).join('') + '…'
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

export function SessionPicker(props: {
  sessions: SessionMeta[]
  onSelect: (id: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [cursor, setCursor] = useState(0)
  const stateRef = useRef({ cursor, sessions: props.sessions })
  stateRef.current = { cursor, sessions: props.sessions }

  const inputHandler = useCallback((_input: string, key: import('ink').Key) => {
    const { cursor: c, sessions: s } = stateRef.current
    if (key.upArrow) {
      setCursor(prev => Math.max(0, prev - 1))
    } else if (key.downArrow) {
      setCursor(prev => Math.min(s.length - 1, prev + 1))
    } else if (key.return) {
      const meta = s[c]
      if (meta) props.onSelect(meta.id)
    } else if (key.escape) {
      props.onCancel()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useInput(inputHandler)

  if (props.sessions.length === 0) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={P.primary} paddingX={1}>
        <Text color={P.primary} bold>Resume session</Text>
        <Text color={P.fg}>No past sessions.</Text>
        <Text color={P.fg} dimColor>esc to cancel</Text>
      </Box>
    )
  }

  return <SessionList {...props} cursor={cursor} />
}

function SessionList(props: {
  sessions: SessionMeta[]
  onSelect: (id: string) => void
  onCancel: () => void
  cursor: number
}): React.JSX.Element {
  const { columns } = useTerminalSize()
  // 4 cols of chrome: border(2) + paddingX(2). Truncate row to fit terminal.
  const rowWidth = Math.max(20, columns - 4)
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={P.primary} paddingX={1}>
      <Text color={P.primary} bold>Resume session</Text>
      {props.sessions.map((meta, i) => {
        const modelShort = middleTruncate(meta.model, 24)
        const row = `${i === props.cursor ? '›' : ' '} ${meta.id.slice(0, 8)}  ${formatDate(meta.updatedAt)}  ${modelShort}  msgs=${meta.messageCount}`
        return (
          <Text key={meta.id} color={i === props.cursor ? P.primary : P.fg}>
            {truncateRight(row, rowWidth)}
          </Text>
        )
      })}
      <Text color={P.fg} dimColor>↑↓ navigate · enter select · esc cancel</Text>
    </Box>
  )
}
