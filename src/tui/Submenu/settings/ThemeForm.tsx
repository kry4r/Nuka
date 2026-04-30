// src/tui/Submenu/settings/ThemeForm.tsx
//
// Phase 12 §4.7 — selects theme.name among the five seed themes.

import React, { useEffect, useState } from 'react'
import { Box, Text } from 'ink'
import { Field } from './Field'
import { listThemes } from '../../../core/theme/themes'
import type { FormCommonProps } from './SettingsSubmenu'

export function ThemeForm(props: FormCommonProps): React.JSX.Element {
  const choices = listThemes().map(t => t.name)
  const initial = (props.config.theme as { name?: string } | undefined)?.name ?? 'default-dark'
  const [name, setName] = useState<string>(initial)

  useEffect(() => {
    const cur = (props.config.theme as { name?: string } | undefined)?.name ?? 'default-dark'
    setName(cur)
  }, [props.config])

  useEffect(() => {
    props.setFormSave(async () => {
      try {
        await props.onSave(obj => {
          obj.theme = { ...(obj.theme ?? {}), name }
        })
      } catch {
        props.flashError('Theme:name')
      }
    })
    return () => props.setFormSave(null)
  }, [name, props])

  return (
    <Box flexDirection="column">
      <Text>Theme</Text>
      <Field
        label="name"
        type="select"
        choices={choices}
        value={name}
        focused={props.focused && props.fieldIdx === 0}
        errored={props.erroredField === 'Theme:name'}
        onChange={v => typeof v === 'string' && setName(v)}
      />
    </Box>
  )
}
