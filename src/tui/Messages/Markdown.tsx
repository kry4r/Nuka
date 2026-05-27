// src/tui/Messages/Markdown.tsx
import React from 'react'
import { Text } from 'ink'

const GFM_TASK_RE = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/

function renderTaskListCheckboxes(source: string): string {
  return source
    .split('\n')
    .map(line => {
      const match = GFM_TASK_RE.exec(line)
      if (!match) return line
      const [, indent, state, label] = match
      const mark = state?.toLowerCase() === 'x' ? '[x]' : '[ ]'
      return `${indent}${mark} ${label}`
    })
    .join('\n')
}

// Phase 1 Markdown: mostly pass-through. Targeted GFM affordances can be
// rendered here before a full marked + cli-highlight pass exists.
export function Markdown({ source }: { source: string }): React.JSX.Element {
  return <Text>{renderTaskListCheckboxes(source)}</Text>
}
