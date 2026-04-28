// src/tui/SlashCard/ArgHint.tsx
//
// Renders the arg-hint card shown when the user has typed a slash command
// followed by a space (e.g. "/model "). Shows Usage / Args / Examples for
// fully-populated commands, or a degenerate single-line "Usage: /name" card
// for sparse commands.
//
// Border colour follows the focus-ring rule (§4.9): when the SlashCard owns
// keyboard focus its frame is `primary`, otherwise `fgMuted`. App.tsx is
// always the focus owner when the slash card is mounted, so callers default
// to `focused = true`.

import React from 'react'
import { Box, Text } from 'ink'
import { defaultPalette as P } from '../theme'
import type { SlashCommand } from '../../slash/types'

export function ArgHint(props: {
  command: SlashCommand
  focused?: boolean
}): React.JSX.Element | null {
  const { command } = props
  const focused = props.focused !== false
  const borderColor = focused ? P.primary : P.fgMuted
  const hasArgs = command.args && command.args.length > 0
  const hasExamples = command.examples && command.examples.length > 0
  const hasUsage = !!command.usage

  // Degenerate card: only command name known.
  if (!hasUsage && !hasArgs && !hasExamples) {
    return (
      <Box flexDirection="column" paddingX={1} borderStyle="single" borderColor={borderColor}>
        <Text color={P.primary}>Usage: <Text color={P.fg}>/{command.name}</Text></Text>
      </Box>
    )
  }

  const usageText = command.usage ?? `/${command.name}`

  return (
    <Box flexDirection="column" paddingX={1} borderStyle="single" borderColor={borderColor}>
      <Text color={P.primary}>
        {'Usage: '}<Text color={P.fg}>{usageText}</Text>
        {command.description ? <Text color={P.fgMuted}>  — {command.description}</Text> : null}
      </Text>
      {hasArgs && (
        <Box flexDirection="column" marginTop={0}>
          <Text color={P.accentInfo}>Args:</Text>
          {command.args!.map(arg => (
            <Box key={arg.name}>
              <Text color={P.fg}>
                {'  '}<Text color={P.primary}>{arg.name}</Text>
                {arg.choices ? <Text color={P.fgMuted}>  [{arg.choices.join('|')}]</Text> : null}
                {arg.description ? <Text color={P.fgMuted}>  {arg.description}</Text> : null}
              </Text>
            </Box>
          ))}
        </Box>
      )}
      {hasExamples && (
        <Box flexDirection="column" marginTop={0}>
          <Text color={P.accentInfo}>Examples:</Text>
          {command.examples!.map((ex, i) => (
            <Text key={i} color={P.fgMuted}>  {ex}</Text>
          ))}
        </Box>
      )}
    </Box>
  )
}
