// src/tui/SlashCard/CommandList.tsx
//
// Renders a grouped list of slash commands: builtins → plugins → skills.
// Each group has a heading, and the selected row is highlighted.
//
// Border colour follows the focus-ring rule (§4.9): when the SlashCard owns
// keyboard focus its frame is `primary`, otherwise `fgMuted`. The wrapper
// (SlashCard.tsx) is always the focused frame in `slash` UIState, so callers
// default `focused` to true.

import React from 'react'
import { Box, Text } from 'ink'
import { defaultPalette as P } from '../theme'
import { useTerminalSize } from '../hooks/useTerminalSize'
import type { SlashCommand } from '../../slash/types'
import { padToWidth, truncateByWidth } from '../../core/stringWidth'

// Default visible window. The fix for the "missing /fork" bug is the
// short-circuit below: when the rendered row count (heading + commands)
// is at most this value we skip the sliding window entirely, so users
// browsing a filtered short list never lose a candidate to pagination
// chrome. The window itself stays at 10 — empirically stable in the
// existing harness tests.
const WINDOW_SIZE = 10
const NAME_WIDTH = 14

type Group = {
  label: string
  commands: SlashCommand[]
}

function buildGroups(commands: SlashCommand[]): Group[] {
  const builtins = commands.filter(c => !c.source || c.source === 'builtin')
  const plugins = commands.filter(c => c.source === 'plugin')
  const skills = commands.filter(c => c.source === 'skill')

  const groups: Group[] = []
  if (builtins.length > 0) groups.push({ label: `builtins (${builtins.length})`, commands: builtins })
  if (plugins.length > 0) groups.push({ label: `plugins (${plugins.length})`, commands: plugins })
  if (skills.length > 0) groups.push({ label: `skills (${skills.length})`, commands: skills })
  return groups
}

export function CommandList(props: {
  commands: SlashCommand[]
  selectedIndex: number
  focused?: boolean
}): React.JSX.Element | null {
  const { commands, selectedIndex } = props
  const focused = props.focused !== false
  const { columns } = useTerminalSize()
  if (commands.length === 0) return null

  const groups = buildGroups(commands)
  const sel = Math.max(0, Math.min(selectedIndex, commands.length - 1))

  // Inner content width inside the SlashCard: terminal cols − 2 (border) − 2 (paddingX).
  // Each command row also reserves: cursor(1) + space(1) + '/'(1) + name(14 cells) + 2 spaces = 19.
  const innerWidth = Math.max(20, columns - 4)
  const descBudget = Math.max(8, innerWidth - 19)

  // Build a flat list of rows (group headings + command rows) for windowing.
  type Row =
    | { kind: 'heading'; label: string }
    | { kind: 'command'; cmd: SlashCommand; globalIdx: number }

  const rows: Row[] = []
  let globalIdx = 0
  for (const group of groups) {
    rows.push({ kind: 'heading', label: group.label })
    for (const cmd of group.commands) {
      rows.push({ kind: 'command', cmd, globalIdx })
      globalIdx++
    }
  }

  // Find the row position of the selected command for windowing.
  const selectedRowPos = rows.findIndex(r => r.kind === 'command' && r.globalIdx === sel)

  // Compute sliding window centred on selected row.
  // Short-circuit when the entire list fits in the window: we render every
  // row so the user can never "scroll past" a command by accident (Bug A:
  // /fork vanished once the cursor moved past the top window).
  const total = rows.length
  let start: number
  let end: number
  if (total <= WINDOW_SIZE) {
    start = 0
    end = total
  } else {
    const half = Math.floor(WINDOW_SIZE / 2)
    start = Math.max(0, selectedRowPos - half)
    end = Math.min(total, start + WINDOW_SIZE)
    if (end - start < WINDOW_SIZE) start = Math.max(0, end - WINDOW_SIZE)
  }
  const slice = rows.slice(start, end)
  const showUp = start > 0
  const showDown = end < total

  const borderColor = focused ? P.primary : P.fgMuted

  return (
    <Box
      flexDirection="column"
      paddingX={1}
      borderStyle="single"
      borderColor={borderColor}
    >
      {showUp && (
        <Text color={P.fgMuted}>  ↑ more above</Text>
      )}
      {slice.map((row, i) => {
        if (row.kind === 'heading') {
          return (
            <Box key={`heading-${row.label}-${i}`}>
              <Text color={P.accentInfo} bold>  {row.label}</Text>
            </Box>
          )
        }
        const selected = row.globalIdx === sel
        const rawName = row.cmd.name
        const name = padToWidth(truncateByWidth(rawName, NAME_WIDTH), NAME_WIDTH)
        const desc = truncateByWidth(row.cmd.description ?? '', descBudget)
        return (
          <Box key={`cmd-${row.cmd.name}`} backgroundColor={selected ? P.primaryDeep : undefined}>
            <Text color={selected ? P.fg : P.fgMuted} wrap="truncate-end">
              {selected ? '›' : ' '} /{name}  {desc}
            </Text>
          </Box>
        )
      })}
      {showDown && (
        <Text color={P.fgMuted}>  ↓ more below</Text>
      )}
    </Box>
  )
}
