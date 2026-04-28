// src/tui/SlashCard/SlashCard.tsx
//
// Top-level slash card rendered in the Status slot when UIState.kind === 'slash'
// (i.e. when `slashOpen` is true in App.tsx).
//
// Switches between two modes:
//   - "slash:list"    — value starts with `/` and has no space → shows CommandList
//   - "slash:arg-hint" — value starts with `/` and has a space → shows ArgHint
//
// The slash:list ↔ slash:arg-hint distinction lives HERE, not in PromptInput.
//
// `focused` is forwarded to the inner frame (CommandList / ArgHint) per the
// focus-ring rule (§4.9). App.tsx renders the SlashCard as focused whenever
// UIState.kind === 'slash'.

import React from 'react'
import { CommandList } from './CommandList'
import { ArgHint } from './ArgHint'
import type { SlashRegistry } from '../../slash/registry'

export type SlashCardProps = {
  /** Current prompt input value (starts with '/'). */
  value: string
  /** The slash registry to look up commands. */
  registry: SlashRegistry
  /** Currently selected candidate index (for list mode). */
  selectedIndex: number
  /** Whether the slash card frame currently owns keyboard focus. */
  focused?: boolean
}

export function SlashCard(props: SlashCardProps): React.JSX.Element | null {
  const { value, registry, selectedIndex } = props
  const focused = props.focused !== false

  if (!value.startsWith('/')) return null

  const hasSpace = value.includes(' ')

  if (hasSpace) {
    // arg-hint mode: find the command by name
    const name = value.slice(1).split(/\s/)[0] ?? ''
    const cmd = registry.find(name)
    if (!cmd) return null
    return <ArgHint command={cmd} focused={focused} />
  }

  // list mode: show all candidates matching the prefix
  const prefix = value.slice(1)
  const candidates = registry.suggest(prefix)
  if (candidates.length === 0) return null

  return (
    <CommandList
      commands={candidates}
      selectedIndex={selectedIndex}
      focused={focused}
    />
  )
}
