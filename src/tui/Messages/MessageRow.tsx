// src/tui/Messages/MessageRow.tsx
import React from 'react'
import { Box, Text } from 'ink'
import type { Message } from '../../core/message/types'
import { defaultPalette as P } from '../theme'
import { Markdown } from './Markdown'
import { ToolCall } from './ToolCall'

function summarize(input: unknown): string {
  const s = JSON.stringify(input)
  if (s.length <= 80) return s
  return s.slice(0, 80) + '…'
}

export function MessageRow(props: {
  m: Message
  resolveToolSource?: (toolName: string) => 'builtin' | 'skill' | 'mcp' | 'plugin' | undefined
  resolveToolAnnotations?: (toolName: string) => { readOnly?: boolean; destructive?: boolean; openWorld?: boolean } | undefined
}): React.JSX.Element | null {
  const { m } = props
  if (m.role === 'system') return null
  const speaker = m.role === 'user' ? 'you' : m.role === 'assistant' ? 'nuka' : 'tool'
  const color = m.role === 'user' ? P.muted : m.role === 'assistant' ? P.primary : P.accent

  if (m.role === 'tool') {
    const toolContent = typeof m.content === 'string'
      ? m.content
      : m.content.map(b => b.type === 'text' ? b.text : `[${b.type}]`).join('\n')
    return (
      <Box flexDirection="column" marginY={1}>
        <Text color={color} bold>▎ {speaker}</Text>
        <Box marginLeft={2}>
          <Markdown source={toolContent} />
        </Box>
      </Box>
    )
  }

  if (m.role === 'assistant') {
    const blocks = m.content
    return (
      <Box flexDirection="column" marginY={1}>
        <Text color={color} bold>▎ {speaker}</Text>
        <Box flexDirection="column" marginLeft={2}>
          {blocks.map((b: any, i: number) => {
            if (b.type === 'text') {
              return <Markdown key={i} source={b.text} />
            }
            if (b.type === 'tool_use') {
              return (
                <ToolCall
                  key={i}
                  name={b.name}
                  argSummary={summarize(b.input)}
                  status="ok"
                  source={props.resolveToolSource?.(b.name)}
                  annotations={props.resolveToolAnnotations?.(b.name)}
                />
              )
            }
            return null
          })}
        </Box>
      </Box>
    )
  }

  // user message
  const text = m.content.map((b: any) => (b.type === 'text' ? b.text : '')).join('')
  return (
    <Box flexDirection="column" marginY={1}>
      <Text color={color} bold>▎ {speaker}</Text>
      <Box marginLeft={2}>
        <Markdown source={text} />
      </Box>
    </Box>
  )
}
