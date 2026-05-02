// src/tui/Rewind/MessageSelector.tsx
//
// Phase 8 §4.3 — interactive selector for `/rewind`.
//
// Lists the last 10 assistant messages (newest first) with one-line previews.
// Arrow keys move, Enter picks, Esc cancels.

import React, { useState, useRef, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'
import stringWidth from 'string-width'
import type { AssistantMessage } from '../../core/message/types'
import { firstLinePreview } from '../../slash/rewind'
import { defaultPalette as P } from '../theme'
import { useTerminalSize } from '../hooks/useTerminalSize'

/** Width-aware right-truncation: keeps head, drops tail with trailing "…". */
function truncateRight(s: string, maxWidth: number): string {
  if (maxWidth <= 0) return ''
  if (stringWidth(s) <= maxWidth) return s
  const budget = maxWidth - 1
  const chars = Array.from(s)
  let width = 0
  let i = 0
  while (i < chars.length) {
    const ch = chars[i]!
    const w = stringWidth(ch)
    if (width + w > budget) break
    width += w
    i++
  }
  return chars.slice(0, i).join('') + '…'
}

export type MessageSelectorProps = {
  /** Assistant messages, newest first (already sliced to last N). */
  messages: AssistantMessage[]
  onSelect: (messageId: string) => void
  onCancel: () => void
}

export function MessageSelector(props: MessageSelectorProps): React.JSX.Element {
  const [cursor, setCursor] = useState(0)
  const stateRef = useRef({ cursor, messages: props.messages, onSelect: props.onSelect, onCancel: props.onCancel })
  stateRef.current = { cursor, messages: props.messages, onSelect: props.onSelect, onCancel: props.onCancel }

  const handler = useCallback((_input: string, key: import('ink').Key) => {
    const { cursor: c, messages, onSelect, onCancel } = stateRef.current
    if (key.upArrow) setCursor(v => Math.max(0, v - 1))
    else if (key.downArrow) setCursor(v => Math.min(messages.length - 1, v + 1))
    else if (key.return) {
      const picked = messages[c]
      if (picked) onSelect(picked.id)
    } else if (key.escape) {
      onCancel()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useInput(handler)

  if (props.messages.length === 0) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={P.primary} paddingX={1}>
        <Text color={P.warn}>No assistant messages to rewind to yet.</Text>
        <Text color={P.fgMuted}>(Esc to dismiss)</Text>
      </Box>
    )
  }

  return <RewindList {...props} cursor={cursor} />
}

function RewindList(props: MessageSelectorProps & { cursor: number }): React.JSX.Element {
  const { columns } = useTerminalSize()
  // 8 cols of chrome: cursor "› " + index "NN. " + border + paddingX + safety.
  const previewWidth = Math.max(20, columns - 8)
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={P.primary} paddingX={1}>
      <Text color={P.primary} bold>Rewind — pick a message to truncate at</Text>
      {props.messages.map((m, i) => (
        <Text key={m.id} color={i === props.cursor ? P.primary : P.fg}>
          {i === props.cursor ? '›' : ' '} {i + 1}. {truncateRight(firstLinePreview(m), previewWidth)}
        </Text>
      ))}
      <Text color={P.fgMuted}>↑/↓ move  Enter pick  Esc cancel</Text>
    </Box>
  )
}
