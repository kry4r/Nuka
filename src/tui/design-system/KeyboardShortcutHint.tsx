// src/tui/design-system/KeyboardShortcutHint.tsx
//
// Phase C — port of Nuka-Code's KeyboardShortcutHint.  Renders text like
// "Enter to confirm" or "(ctrl+o to expand)".  Wrap in <Text dimColor> for
// the common dim styling.

import React from 'react'
import { Text } from 'ink'

export type KeyboardShortcutHintProps = {
  /** The key or chord (e.g. "Esc", "ctrl+o", "↵"). */
  shortcut: string
  /** What it does (e.g. "expand", "cancel"). */
  action: string
  /** Wrap the whole hint in parentheses. */
  parens?: boolean
  /** Render the shortcut in bold. */
  bold?: boolean
}

export function KeyboardShortcutHint(
  props: KeyboardShortcutHintProps,
): React.JSX.Element {
  const { shortcut, action, parens = false, bold = false } = props
  const shortcutNode = bold ? <Text bold>{shortcut}</Text> : <>{shortcut}</>
  if (parens) {
    return (
      <Text>({shortcutNode} to {action})</Text>
    )
  }
  return (
    <Text>{shortcutNode} to {action}</Text>
  )
}
