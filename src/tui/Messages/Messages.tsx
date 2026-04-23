// src/tui/Messages/Messages.tsx
import React from 'react'
import { Box, Static } from 'ink'
import { MessageRow } from './MessageRow'
import type { Message } from '../../core/message/types'

export function Messages(props: {
  items: Message[]
  streaming: Message | null
}): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Static items={props.items}>
        {(m, i) => <MessageRow key={'id' in m ? m.id : i} m={m} />}
      </Static>
      {props.streaming && <MessageRow m={props.streaming} />}
    </Box>
  )
}
