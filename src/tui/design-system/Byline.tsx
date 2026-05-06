// src/tui/design-system/Byline.tsx
//
// Phase C — port of Nuka-Code's Byline (joins children with " | " separators).
// Plain-React rewrite (the upstream file ships pre-compiled by the React
// compiler; that scaffolding is dropped here).

import React, { Children, isValidElement } from 'react'
import { Text } from 'ink'

export type BylineProps = {
  /** Items to join with a middot separator. */
  children: React.ReactNode
}

/**
 * Renders children separated by ` | `.  Filters out null/false/undefined.
 *
 *   <Byline>
 *     <KeyboardShortcutHint shortcut="Enter" action="confirm" />
 *     <KeyboardShortcutHint shortcut="Esc" action="cancel" />
 *   </Byline>
 */
export function Byline({ children }: BylineProps): React.JSX.Element | null {
  const valid = Children.toArray(children)
  if (valid.length === 0) return null
  return (
    <>
      {valid.map((child, index) => (
        <React.Fragment
          key={isValidElement(child) ? (child.key ?? index) : index}
        >
          {index > 0 && <Text dimColor> | </Text>}
          {child}
        </React.Fragment>
      ))}
    </>
  )
}
