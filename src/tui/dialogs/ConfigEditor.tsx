// src/tui/dialogs/ConfigEditor.tsx
import React from 'react'
import { Box, Text, useInput } from 'ink'
import { defaultPalette as P } from '../theme'

export function ConfigEditor(props: {
  configPath: string
  preview: string
  onOpen: () => void
  onClose: () => void
}): React.JSX.Element {
  useInput((input, key) => {
    if (key.return || input === 'e') props.onOpen()
    else if (key.escape) props.onClose()
  })
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={P.primary} paddingX={1}>
      <Text color={P.primary} bold>Config · {props.configPath}</Text>
      <Box height={1} />
      <Text color={P.fg}>{props.preview}</Text>
      <Box height={1} />
      <Text color={P.muted}>press ⏎ or e to open $EDITOR · esc to close</Text>
    </Box>
  )
}
