// src/tui/Submenu/config/StatusBarForm.tsx
//
// Phase 12 §4.7 — canonical example form. Edits:
//   - statusBar.layout (select: dense / compact / oneline)
//   - statusBar.hidden (per-segment toggle list)
//
// Toggling a segment "on" means that segment id is included in the
// `hidden` array. Six segments per spec §4.5: mode/model/cwd/context/
// cost-time/counts.

import React, { useEffect, useState, useCallback } from 'react'
import { Box, Text } from 'ink'
import { Field } from './Field'
import type { FormCommonProps } from './ConfigSubmenu'

const LAYOUTS = ['dense', 'compact', 'oneline'] as const
type Layout = typeof LAYOUTS[number]

const SEGMENTS = ['mode', 'model', 'cwd', 'context', 'cost-time', 'counts'] as const

export function StatusBarForm(props: FormCommonProps): React.JSX.Element {
  const initialLayout: Layout = (props.config.statusBar?.layout ?? 'dense') as Layout
  const initialHidden = new Set(props.config.statusBar?.hidden ?? [])
  const [layout, setLayout] = useState<Layout>(initialLayout)
  const [hidden, setHidden] = useState<Set<string>>(initialHidden)

  useEffect(() => {
    setLayout((props.config.statusBar?.layout ?? 'dense') as Layout)
    setHidden(new Set(props.config.statusBar?.hidden ?? []))
  }, [props.config])

  const toggleSegment = useCallback((seg: string, makeHidden: boolean) => {
    setHidden(prev => {
      const next = new Set(prev)
      if (makeHidden) next.add(seg)
      else next.delete(seg)
      return next
    })
  }, [])

  useEffect(() => {
    props.setFormSave(async () => {
      try {
        await props.onSave(obj => {
          obj.statusBar = {
            ...(obj.statusBar ?? {}),
            layout,
            hidden: Array.from(hidden),
          }
        })
      } catch {
        props.flashError('StatusBar:layout')
      }
    })
    return () => props.setFormSave(null)
  }, [layout, hidden, props])

  const fId = (i: number) => props.focused && props.fieldIdx === i

  return (
    <Box flexDirection="column">
      <Text>StatusBar</Text>
      <Field
        label="layout"
        type="select"
        choices={[...LAYOUTS]}
        value={layout}
        focused={fId(0)}
        errored={props.erroredField === 'StatusBar:layout'}
        onChange={v => typeof v === 'string' && (LAYOUTS as readonly string[]).includes(v) && setLayout(v as Layout)}
      />
      {SEGMENTS.map((seg, i) => (
        <Field
          key={seg}
          label={`hide:${seg}`}
          type="toggle"
          value={hidden.has(seg)}
          focused={fId(i + 1)}
          errored={props.erroredField === `StatusBar:hidden.${seg}`}
          onChange={v => toggleSegment(seg, v === true)}
        />
      ))}
    </Box>
  )
}
