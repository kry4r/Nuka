// src/tui/dialogs/SessionPicker.tsx
import React, { useState, useRef, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'
import type { SessionMeta } from '../../core/session/store'
import { defaultPalette as P } from '../theme'

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

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={P.primary} paddingX={1}>
      <Text color={P.primary} bold>Resume session</Text>
      {props.sessions.map((meta, i) => (
        <Text key={meta.id} color={i === cursor ? P.primary : P.fg}>
          {i === cursor ? '›' : ' '} {meta.id.slice(0, 8)}  {formatDate(meta.updatedAt)}  {meta.model}  msgs={meta.messageCount}
        </Text>
      ))}
      <Text color={P.fg} dimColor>↑↓ navigate · enter select · esc cancel</Text>
    </Box>
  )
}
