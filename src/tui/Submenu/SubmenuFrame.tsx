// src/tui/Submenu/SubmenuFrame.tsx
//
// Phase 12 §4.6 — common chrome for every submenu (full or inline). The
// concrete dialog (ModelPicker, ConfigSubmenu, PermissionDialog, …) is
// rendered as `children`; SubmenuFrame supplies the title bar + frame
// border + (optional) footer hint. App.tsx is responsible for placing
// the frame in the correct zone slot:
//   - mode="full":   replaces Tasks/Prompt/Status entirely
//   - mode="inline": replaces only the Prompt slot
//
// Border colour follows the focus-ring rule (§4.9): focused frame uses
// `primary`, unfocused uses `fgMuted`.

import React from 'react'
import { Box, Text } from 'ink'
import { useTheme } from '../../core/theme/context'
import { defaultPalette } from '../theme'
import { useTerminalSize } from '../hooks/useTerminalSize'

export type SubmenuMode = 'full' | 'inline'

export type SubmenuFrameProps = {
  mode: SubmenuMode
  title: string
  /** Whether this frame currently owns keyboard focus. */
  focused?: boolean
  /** Optional footer text — typically key hints like "⏎ 确认  Esc 关闭". */
  footer?: string
  children: React.ReactNode
}

export function SubmenuFrame(props: SubmenuFrameProps): React.JSX.Element {
  const theme = useTheme()
  const focusColor = theme.colors.primary ?? defaultPalette.primary
  const mutedColor = theme.colors.fgMuted ?? defaultPalette.fgMuted
  const borderColor = props.focused ? focusColor : mutedColor

  const { columns, rows } = useTerminalSize()
  // Outer chrome: 2 (top+bottom border) + 1 (title row) + (footer ? 1 : 0).
  const outerChrome = 2 + 1 + (props.footer ? 1 : 0)
  const innerMaxHeight = Math.max(1, rows - outerChrome)
  // Title is constrained by border (2) + paddingX (2) = 4 columns of chrome.
  const titleWidth = Math.max(1, columns - 4)

  // For full-mode submenus we explicitly clamp the inner content box to a
  // fixed height so children that exceed the viewport are clipped rather
  // than pushing the frame off-screen. Inline-mode frames sit inside the
  // Prompt slot and should hug their content size, so we don't pin a height
  // there — `overflow="hidden"` still guards against runaway children.
  const innerHeightProps =
    props.mode === 'full'
      ? ({ height: innerMaxHeight } as const)
      : ({} as const)

  return (
    <Box
      flexDirection="column"
      flexShrink={0}
      borderStyle={props.mode === 'full' ? 'round' : 'single'}
      borderColor={borderColor}
      paddingX={1}
    >
      <Box width={titleWidth} flexShrink={0}>
        <Text color={borderColor} bold wrap="truncate-end">{props.title}</Text>
      </Box>
      <Box flexDirection="column" overflow="hidden" {...innerHeightProps}>
        {props.children}
      </Box>
      {props.footer && (
        <Box width={titleWidth} flexShrink={0}>
          <Text color={mutedColor} wrap="truncate-end">{props.footer}</Text>
        </Box>
      )}
    </Box>
  )
}
