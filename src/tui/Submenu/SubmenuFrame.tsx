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

  return (
    <Box
      flexDirection="column"
      borderStyle={props.mode === 'full' ? 'round' : 'single'}
      borderColor={borderColor}
      paddingX={1}
    >
      <Box>
        <Text color={borderColor} bold>{props.title}</Text>
      </Box>
      <Box flexDirection="column">
        {props.children}
      </Box>
      {props.footer && (
        <Box>
          <Text color={mutedColor}>{props.footer}</Text>
        </Box>
      )}
    </Box>
  )
}
