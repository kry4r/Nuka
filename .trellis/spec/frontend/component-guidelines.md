# Component Guidelines

> How components are built in this project.

---

## Overview

Components render terminal UI with Ink and React. Prefer small function
components, typed props, and width-aware rendering. Avoid decorative chrome
unless it improves scanning of repeated operational information.

---

## Component Structure

Use this order for component files:

1. Imports from React/Ink, core helpers, then local theme/types.
2. Local helper functions and exported prop types.
3. One exported component function.
4. Small private rendering helpers only when they reduce repeated JSX.

Example:

```typescript
import React from 'react'
import { Box, Text, useStdout } from 'ink'
import { stringWidth, truncateByWidth } from '../../core/stringWidth'
import { defaultPalette as P } from '../theme'

export function ToolCall(props: {
  name: string
  argSummary: string
  status: 'running' | 'ok' | 'error'
}): React.JSX.Element {
  const { stdout } = useStdout()
  const columns = process.stdout.columns ?? stdout?.columns ?? 80
  const summary = truncateByWidth(props.argSummary, Math.max(1, columns - 20))
  return <Text>{props.name} {summary}</Text>
}
```

Reference: `src/tui/Messages/ToolCall.tsx`,
`src/tui/Status/StatusPanel.tsx`, `src/tui/Tasks/SubagentList.tsx`.

---

## Props Conventions

- Export prop types when another module or test imports them:
  `StatusPanelProps`, `TasksPanelProps`, `MentionPaletteProps`.
- Inline props are fine for small leaf components that are not reused as a
  public contract, as in `ToolCall`.
- Use discriminated unions or string literal unions for state-like values:
  `status: 'running' | 'ok' | 'error'`, `layout: 'dense' | 'compact' | 'oneline'`.
- Keep callback props typed by behavior, not by UI event. For example,
  `onOpenEditor`, `onExit`, `onSubmit`, and `onTransition` are domain actions.

Do not pass raw task/provider/session objects through multiple TUI layers when
a compact display model already exists. `src/tui/Tasks/columnReducer.ts`
converts task events into `Row` objects before rendering.

---

## Styling Patterns

Styling is Ink props plus the shared palette:

- Use `defaultPalette` or `useTheme()` for colors. Do not hard-code color names
  when the palette has an equivalent role.
- Prefer unframed layouts and concise rows. Cards/borders are reserved for
  bounded tool progress, dialogs, and genuinely framed tools.
- Stable dimensions matter. Use `width`, `minWidth`, `flexDirection`, and
  explicit truncation budgets for terminal-visible rows.
- For any visible cap or alignment, use `stringWidth`, `truncateByWidth`, or a
  local helper built from `string-width`; never assume one JavaScript code unit
  equals one terminal cell.

Reference examples:

- `src/tui/Status/StatusPanel.tsx` truncates provider/model/cwd by display width.
- `src/tui/Messages/AgentCall.tsx` keeps CJK task text inside the header.
- `src/tui/design-system/BorderedBox.tsx` measures title width before drawing.

---

## Accessibility

Terminal accessibility means predictable keyboard behavior and low-noise text:

- If visible text advertises a key, the component must actually handle that key.
  `AwaySummaryCard` removed a misleading `esc` hint because it had no input
  handler.
- Keep input ownership clear. Root-level flows such as onboarding use a single
  `useInput` handler at the root instead of mounting/unmounting child handlers.
- Focused text inputs need production-mode cursor tests when cursor placement
  changes. See `test/tui/PromptInput.cursorAnsi.test.tsx` and
  `test/tui/LayoutGuards.harness.test.tsx`.
- Avoid instructional clutter in steady-state UI. Status and task panels should
  show current state first, not a help page.

---

## Common Mistakes

- Adding text to a narrow row without a display-width budget.
- Showing a keyboard shortcut in UI copy without a matching `useInput` path.
- Nesting bordered panels inside other panels, which wastes terminal space and
  triggers border bleed in narrow captures.
- Testing only `ink-testing-library` debug output for a fullscreen App bug.
  Use `renderWithViewport` when static scrollback, cursor ANSI, or viewport
  clipping matters.
