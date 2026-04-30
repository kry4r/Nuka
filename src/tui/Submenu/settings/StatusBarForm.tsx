// src/tui/Submenu/settings/StatusBarForm.tsx
//
// Phase 13 §4.2 — updated for new segment set and iconMode field.
// Edits:
//   - statusBar.layout (select: dense / compact / oneline)
//   - statusBar.iconMode (select: icon / text)
//   - statusBar.hidden (per-segment toggle list)
//
// Toggling a segment "on" means that segment id is included in the
// `hidden` array. Current segments (Phase 13): mode/model/cwd/context/
// cost/counts.

import React, { useEffect, useState, useCallback } from 'react'
import { Box, Text } from 'ink'
import { Field } from './Field'
import type { FormCommonProps } from './SettingsSubmenu'

const LAYOUTS = ['dense', 'compact', 'oneline'] as const
type Layout = typeof LAYOUTS[number]

const ICON_MODES = ['icon', 'text'] as const
type IconMode = typeof ICON_MODES[number]

const SEGMENTS = ['mode', 'model', 'cwd', 'context', 'cost', 'counts'] as const

export function StatusBarForm(props: FormCommonProps): React.JSX.Element {
  const initialLayout: Layout = (props.config.statusBar?.layout ?? 'dense') as Layout
  const initialIconMode: IconMode = ((props.config.statusBar as any)?.iconMode ?? 'icon') as IconMode
  const initialHidden = new Set(props.config.statusBar?.hidden ?? [])
  const [layout, setLayout] = useState<Layout>(initialLayout)
  const [iconMode, setIconMode] = useState<IconMode>(initialIconMode)
  const [hidden, setHidden] = useState<Set<string>>(initialHidden)

  useEffect(() => {
    setLayout((props.config.statusBar?.layout ?? 'dense') as Layout)
    setIconMode(((props.config.statusBar as any)?.iconMode ?? 'icon') as IconMode)
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
            iconMode,
            hidden: Array.from(hidden),
          }
        })
      } catch {
        props.flashError('StatusBar:layout')
      }
    })
    return () => props.setFormSave(null)
  }, [layout, iconMode, hidden, props])

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
      <Field
        label="iconMode"
        type="select"
        choices={[...ICON_MODES]}
        value={iconMode}
        focused={fId(1)}
        errored={props.erroredField === 'StatusBar:iconMode'}
        onChange={v => typeof v === 'string' && (ICON_MODES as readonly string[]).includes(v) && setIconMode(v as IconMode)}
      />
      {SEGMENTS.map((seg, i) => (
        <Field
          key={seg}
          label={`hide:${seg}`}
          type="toggle"
          value={hidden.has(seg)}
          focused={fId(i + 2)}
          errored={props.erroredField === `StatusBar:hidden.${seg}`}
          onChange={v => toggleSegment(seg, v === true)}
        />
      ))}
    </Box>
  )
}
