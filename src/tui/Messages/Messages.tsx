// src/tui/Messages/Messages.tsx
import React from 'react'
import { Box, Static } from 'ink'
import { MessageRow } from './MessageRow'
import type { Message } from '../../core/message/types'

export function Messages(props: {
  items: Message[]
  streaming: Message | null
  resolveToolSource?: (toolName: string) => 'builtin' | 'skill' | 'mcp' | 'plugin' | undefined
  resolveToolAnnotations?: (toolName: string) => { readOnly?: boolean; destructive?: boolean; openWorld?: boolean } | undefined
}): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Static items={props.items}>
        {(m, i) => (
          <MessageRow
            key={'id' in m ? m.id : i}
            m={m}
            resolveToolSource={props.resolveToolSource}
            resolveToolAnnotations={props.resolveToolAnnotations}
          />
        )}
      </Static>
      {props.streaming && (
        <MessageRow
          m={props.streaming}
          resolveToolSource={props.resolveToolSource}
          resolveToolAnnotations={props.resolveToolAnnotations}
        />
      )}
    </Box>
  )
}
