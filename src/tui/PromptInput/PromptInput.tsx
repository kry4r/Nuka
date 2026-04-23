// src/tui/PromptInput/PromptInput.tsx
import React from 'react'
import { Box, Text, useInput } from 'ink'
import { defaultPalette as P } from '../theme'

export type PromptInputProps = {
  value: string
  onChange: (v: string) => void
  onSubmit: (v: string) => void
  disabled: boolean
  placeholder?: string
}

export function PromptInput(props: PromptInputProps): React.JSX.Element {
  useInput((input, key) => {
    if (props.disabled) return
    if (key.return) {
      if (props.value.trim()) props.onSubmit(props.value)
      return
    }
    if (key.backspace || key.delete) {
      props.onChange(props.value.slice(0, -1))
      return
    }
    if (!key.ctrl && !key.meta && input) {
      props.onChange(props.value + input)
    }
  }, { isActive: !props.disabled })

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={P.primary}>▎ </Text>
        <Text color={P.primary}>{'> '}</Text>
        <Text color={P.fg}>{props.value || (props.placeholder ?? '')}</Text>
      </Box>
    </Box>
  )
}
