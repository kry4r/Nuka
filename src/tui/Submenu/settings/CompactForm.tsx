// src/tui/Submenu/settings/CompactForm.tsx
//
// Phase 12 §4.7 — three numeric fields: keepTurns, autoThreshold,
// contextWindow. All edited as text and parsed at save time so zod
// validation fires on commit and the offending field flashes.

import React, { useEffect, useState } from 'react'
import { Box, Text } from 'ink'
import { Field } from './Field'
import type { FormCommonProps } from './SettingsSubmenu'

export function CompactForm(props: FormCommonProps): React.JSX.Element {
  const c = props.config.compact
  const [keepTurns, setKeepTurns] = useState<string>(String(c?.keepTurns ?? 3))
  const [autoThreshold, setAutoThreshold] = useState<string>(String(c?.autoThreshold ?? 0.8))
  const [contextWindow, setContextWindow] = useState<string>(String(c?.contextWindow ?? 200_000))

  useEffect(() => {
    const c = props.config.compact
    setKeepTurns(String(c?.keepTurns ?? 3))
    setAutoThreshold(String(c?.autoThreshold ?? 0.8))
    setContextWindow(String(c?.contextWindow ?? 200_000))
  }, [props.config])

  useEffect(() => {
    props.setFormSave(async () => {
      const kt = Number(keepTurns)
      const at = Number(autoThreshold)
      const cw = Number(contextWindow)
      // Pre-flight numeric validation; flash the first offending field
      // before we even hit zod (and zod's path[] would point to it too).
      if (!Number.isInteger(kt) || kt <= 0) { props.flashError('Compact:keepTurns'); return }
      if (Number.isNaN(at) || at < 0 || at > 1) { props.flashError('Compact:autoThreshold'); return }
      if (!Number.isInteger(cw) || cw <= 0) { props.flashError('Compact:contextWindow'); return }
      try {
        await props.onSave(obj => {
          obj.compact = {
            ...(obj.compact ?? {}),
            keepTurns: kt,
            autoThreshold: at,
            contextWindow: cw,
          }
        })
      } catch {
        // zod validation failed; flash the first numeric field as a
        // best-effort indicator.
        props.flashError('Compact:keepTurns')
      }
    })
    return () => props.setFormSave(null)
  }, [keepTurns, autoThreshold, contextWindow, props])

  const fId = (i: number) => props.focused && props.fieldIdx === i

  return (
    <Box flexDirection="column">
      <Text>Compact</Text>
      <Field
        label="keepTurns"
        type="text"
        value={keepTurns}
        focused={fId(0)}
        errored={props.erroredField === 'Compact:keepTurns'}
        onChange={v => typeof v === 'string' && setKeepTurns(v)}
      />
      <Field
        label="autoThreshold"
        type="text"
        value={autoThreshold}
        focused={fId(1)}
        errored={props.erroredField === 'Compact:autoThreshold'}
        onChange={v => typeof v === 'string' && setAutoThreshold(v)}
      />
      <Field
        label="contextWindow"
        type="text"
        value={contextWindow}
        focused={fId(2)}
        errored={props.erroredField === 'Compact:contextWindow'}
        onChange={v => typeof v === 'string' && setContextWindow(v)}
      />
    </Box>
  )
}
