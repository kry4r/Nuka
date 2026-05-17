// src/tui/promptMentions/MentionPalette.tsx
//
// Mention palette dropdown — overlay panel shown above the prompt input while
// a `@` trigger is active. Renders two stacked panes:
//
//   ┌──────────────────────────────────────────┐
//   │ types col  │  results col                 │
//   │   file*    │  src/foo.ts                  │
//   │   folder   │  src/bar.ts                  │
//   │   diff     │  ...                         │
//   │            │                              │
//   ├──────────────────────────────────────────┤
//   │ preview line (dim)                        │
//   └──────────────────────────────────────────┘
//
// Stateless / presentational. The active type, focused pane, options list,
// selected index, and optional preview line are all driven by props — usually
// fed by `usePromptMention`. Colours pull from Nuka's 12-key palette (theme.ts).
//
// Renamed from upstream `PromptMentionPanel`; named "MentionPalette" to match
// the iter 3a spec and to disambiguate from the existing Nuka `MentionPanel`
// living next to PromptInput (which is the legacy file-suggester not yet
// touched in this iter).

import React from 'react'
import { Box, Text } from 'ink'
import { defaultPalette as P } from '../theme'
import type { Palette } from '../theme'
import {
  PROMPT_MENTION_TYPES,
  type PromptMentionOption,
  type PromptMentionPane,
  type PromptMentionType,
} from '../../promptContextReferences/palette'

export type MentionPaletteProps = {
  activeType: PromptMentionType
  focusedPane: PromptMentionPane
  options: PromptMentionOption[]
  selectedIndex: number
  /** Optional inline preview line shown below the two panes (dim). */
  preview?: string
  /** Override the canonical type list; primarily for tests/storybook. */
  types?: readonly PromptMentionType[]
  /** Override palette (defaults to defaultPalette). */
  palette?: Palette
  /** Cap the visible result rows so the overlay never overflows a small tty. */
  maxResults?: number
}

const DEFAULT_MAX_RESULTS = 10

export function MentionPalette(props: MentionPaletteProps): React.JSX.Element {
  const p = props.palette ?? P
  const types = props.types ?? PROMPT_MENTION_TYPES
  const cap = props.maxResults ?? DEFAULT_MAX_RESULTS
  const visible = props.options.slice(0, cap)

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={p.fgMuted}
      paddingX={1}
      flexShrink={0}
    >
      <Box>
        <Box flexDirection="column" width={12} marginRight={2} flexShrink={0}>
          {types.map(type => {
            const isActive = type === props.activeType
            const inTypesPane = props.focusedPane === 'types'
            const color = isActive
              ? inTypesPane
                ? p.primary
                : p.primarySoft
              : p.fgMuted
            return (
              <Text key={type} color={color} bold={isActive}>
                {isActive ? '› ' : '  '}
                {type}
              </Text>
            )
          })}
        </Box>
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          {visible.length === 0 ? (
            <Text color={p.fgMuted}>No results</Text>
          ) : (
            visible.map((option, index) => {
              const selected =
                index === props.selectedIndex && props.focusedPane === 'results'
              return (
                <Text
                  key={option.id}
                  color={selected ? p.primary : p.fg}
                  bold={selected}
                  wrap="truncate-end"
                >
                  {selected ? '› ' : '  '}
                  {option.label}
                </Text>
              )
            })
          )}
        </Box>
      </Box>
      {props.preview ? (
        <Box marginTop={1}>
          <Text color={p.fgFaint}>{props.preview}</Text>
        </Box>
      ) : null}
    </Box>
  )
}
