// src/tui/Messages/Markdown.tsx
import React from 'react'
import { Text } from 'ink'

// Phase 1 Markdown: pass-through. Phase 2 can plug in marked + cli-highlight.
export function Markdown({ source }: { source: string }): React.JSX.Element {
  return <Text>{source}</Text>
}
