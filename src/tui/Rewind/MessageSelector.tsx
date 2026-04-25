// src/tui/Rewind/MessageSelector.tsx
//
// Phase 8 §4.3 — interactive selector for `/rewind`.
//
// Lists the last 10 assistant messages (newest first) with one-line previews.
// Arrow keys move, Enter picks, Esc cancels.

import React, { useState, useRef, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'
import type { AssistantMessage } from '../../core/message/types'
import { firstLinePreview } from '../../slash/rewind'
import { defaultPalette as P } from '../theme'

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
        <Text color={P.muted}>(Esc to dismiss)</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={P.primary} paddingX={1}>
      <Text color={P.primary} bold>Rewind — pick a message to truncate at</Text>
      {props.messages.map((m, i) => (
        <Text key={m.id} color={i === cursor ? P.primary : P.fg}>
          {i === cursor ? '›' : ' '} {i + 1}. {firstLinePreview(m)}
        </Text>
      ))}
      <Text color={P.muted}>↑/↓ move  Enter pick  Esc cancel</Text>
    </Box>
  )
}
