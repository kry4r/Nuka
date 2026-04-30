// src/tui/Submenu/settings/WelcomeForm.tsx
//
// Phase 12 §4.7 — read-only display of welcome.tips. Tips can already be
// edited in the YAML directly via `o`; the submenu surfaces them so the
// user knows what's there.

import React, { useEffect } from 'react'
import { Box, Text } from 'ink'
import { useColors } from '../../../core/theme/context'
import type { FormCommonProps } from './SettingsSubmenu'

export function WelcomeForm(props: FormCommonProps): React.JSX.Element {
  const colors = useColors()
  const tips = props.config.welcome?.tips ?? []

  // No save callback — read-only.
  useEffect(() => {
    props.setFormSave(async () => { /* read-only */ })
    return () => props.setFormSave(null)
  }, [props])

  return (
    <Box flexDirection="column">
      <Text>Welcome tips · {tips.length}</Text>
      {tips.length === 0 && <Text color={colors.fgMuted}>(no tips configured — edit YAML to add)</Text>}
      {tips.map((t, i) => (
        <Text key={i} color={colors.fg}>{i + 1}. {t}</Text>
      ))}
      <Box marginTop={1}>
        <Text color={colors.fgMuted}>read-only · use `o` to edit YAML</Text>
      </Box>
    </Box>
  )
}
