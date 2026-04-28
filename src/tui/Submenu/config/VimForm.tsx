// src/tui/Submenu/config/VimForm.tsx
//
// Phase 12 §4.7 — single-toggle form for `vim.enabled`. Smallest example
// of the form contract: holds one Field, registers a save-all callback,
// flashes its frame on validation failure.

import React, { useEffect, useState } from 'react'
import { Box, Text } from 'ink'
import { Field } from './Field'
import type { FormCommonProps } from './ConfigSubmenu'

export function VimForm(props: FormCommonProps): React.JSX.Element {
  const initial = props.config.vim?.enabled === true
  const [enabled, setEnabled] = useState<boolean>(initial)

  useEffect(() => {
    setEnabled(props.config.vim?.enabled === true)
  }, [props.config])

  // Register the save-all callback with the shell.
  useEffect(() => {
    props.setFormSave(async () => {
      try {
        await props.onSave(obj => {
          obj.vim = { ...(obj.vim ?? {}), enabled }
        })
      } catch {
        props.flashError('Vim:enabled')
      }
    })
    return () => props.setFormSave(null)
  }, [enabled, props])

  return (
    <Box flexDirection="column">
      <Text>Vim mode</Text>
      <Field
        label="enabled"
        type="toggle"
        value={enabled}
        focused={props.focused && props.fieldIdx === 0}
        errored={props.erroredField === 'Vim:enabled'}
        onChange={v => setEnabled(v === true)}
      />
    </Box>
  )
}
