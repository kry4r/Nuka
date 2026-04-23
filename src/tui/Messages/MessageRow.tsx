// src/tui/Messages/MessageRow.tsx
import React from 'react'
import { Box, Text } from 'ink'
import type { Message } from '../../core/message/types'
import { defaultPalette as P } from '../theme'
import { Markdown } from './Markdown'

export function MessageRow({ m }: { m: Message }): React.JSX.Element | null {
  if (m.role === 'system') return null
  const speaker = m.role === 'user' ? 'you' : m.role === 'assistant' ? 'nuka' : 'tool'
  const color = m.role === 'user' ? P.muted : m.role === 'assistant' ? P.primary : P.accent
  const text = m.role === 'tool'
    ? m.content
    : m.content.map((b: any) => (b.type === 'text' ? b.text : '')).join('')
  return (
    <Box flexDirection="column" marginY={1}>
      <Text color={color} bold>▎ {speaker}</Text>
      <Box marginLeft={2}>
        <Markdown source={text} />
      </Box>
    </Box>
  )
}
