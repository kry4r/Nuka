// src/tui/Submenu/settings/SkillsForm.tsx
//
// Phase 12 §4.7 — read-only listing of registered skills (no editable
// fields in Phase 12; activation is implicit).

import React, { useEffect } from 'react'
import { Box, Text } from 'ink'
import { useColors } from '../../../core/theme/context'
import type { FormCommonProps } from './SettingsSubmenu'

export type SkillsFormProps = FormCommonProps & {
  loadedSkills: { name: string; description?: string }[]
}

export function SkillsForm(props: SkillsFormProps): React.JSX.Element {
  const colors = useColors()

  useEffect(() => {
    props.setFormSave(async () => { /* read-only */ })
    return () => props.setFormSave(null)
  }, [props])

  return (
    <Box flexDirection="column">
      <Text>Skills · {props.loadedSkills.length} registered</Text>
      {props.loadedSkills.length === 0 && (
        <Text color={colors.fgMuted}>(no skills loaded)</Text>
      )}
      {props.loadedSkills.map((s, i) => (
        <Box key={s.name + i}>
          <Box width={20}>
            <Text color={colors.fg}>{s.name}</Text>
          </Box>
          {s.description && <Text color={colors.fgMuted}>{s.description}</Text>}
        </Box>
      ))}
      <Box marginTop={1}>
        <Text color={colors.fgMuted}>read-only in Phase 12</Text>
      </Box>
    </Box>
  )
}
