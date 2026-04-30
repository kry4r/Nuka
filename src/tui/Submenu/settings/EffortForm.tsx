// src/tui/Submenu/settings/EffortForm.tsx
//
// Settings · Effort — selects reasoning effort (low / medium / high).
// Saves to config.effort via the standard saveConfigPatch mutator.

import React, { useEffect, useState } from 'react'
import { Box, Text } from 'ink'
import { Field } from './Field'
import type { Effort } from '../../../core/config/schema'
import type { FormCommonProps } from './SettingsSubmenu'

const CHOICES: ReadonlyArray<NonNullable<Effort>> = ['low', 'medium', 'high'] as const

export function EffortForm(props: FormCommonProps): React.JSX.Element {
  const initial = ((props.config as { effort?: NonNullable<Effort> }).effort) ?? 'medium'
  const [level, setLevel] = useState<NonNullable<Effort>>(initial)

  useEffect(() => {
    const cur = ((props.config as { effort?: NonNullable<Effort> }).effort) ?? 'medium'
    setLevel(cur)
  }, [props.config])

  useEffect(() => {
    props.setFormSave(async () => {
      try {
        await props.onSave(obj => {
          obj.effort = level
        })
      } catch {
        props.flashError('Effort:level')
      }
    })
    return () => props.setFormSave(null)
  }, [level, props])

  return (
    <Box flexDirection="column">
      <Text>Effort</Text>
      <Field
        label="level"
        type="select"
        choices={CHOICES as unknown as string[]}
        value={level}
        focused={props.focused && props.fieldIdx === 0}
        errored={props.erroredField === 'Effort:level'}
        onChange={v => {
          if (typeof v === 'string' && (v === 'low' || v === 'medium' || v === 'high')) {
            setLevel(v)
          }
        }}
      />
    </Box>
  )
}
