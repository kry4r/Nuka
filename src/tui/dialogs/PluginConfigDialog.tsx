// src/tui/dialogs/PluginConfigDialog.tsx
import React, { useState, useRef } from 'react'
import { Box, Text, useInput } from 'ink'
import { defaultPalette as P } from '../theme'
import type { LoadedPlugin, PluginUserConfigField } from '../../core/plugin/manifest'

export function PluginConfigDialog(props: {
  plugin: LoadedPlugin
  fields: PluginUserConfigField[]
  onSubmit: (values: Record<string, unknown>) => void
  onCancel: () => void
}): React.JSX.Element {
  const { plugin, fields } = props

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      fields.map(f => [f.name, f.default !== undefined ? String(f.default) : '']),
    ),
  )
  const valuesRef = useRef<Record<string, string>>(values)
  const [cursor, setCursor] = useState(0)
  const cursorRef = useRef(0)

  useInput((input, key) => {
    if (key.escape) {
      props.onCancel()
      return
    }

    if (key.tab || key.downArrow) {
      cursorRef.current = (cursorRef.current + 1) % Math.max(1, fields.length)
      setCursor(cursorRef.current)
      return
    }
    if (key.upArrow) {
      cursorRef.current =
        (cursorRef.current - 1 + Math.max(1, fields.length)) % Math.max(1, fields.length)
      setCursor(cursorRef.current)
      return
    }

    if (key.return) {
      // Coerce values to declared types
      const coerced: Record<string, unknown> = {}
      for (const f of fields) {
        const raw = valuesRef.current[f.name] ?? ''
        if (f.type === 'number') {
          coerced[f.name] = raw === '' ? undefined : Number(raw)
        } else if (f.type === 'boolean') {
          coerced[f.name] = raw.toLowerCase() === 'true' || raw === '1' || raw.toLowerCase() === 'yes'
        } else {
          coerced[f.name] = raw
        }
      }
      props.onSubmit(coerced)
      return
    }

    if (key.backspace || key.delete) {
      const field = fields[cursorRef.current]
      if (!field) return
      const next = {
        ...valuesRef.current,
        [field.name]: (valuesRef.current[field.name] ?? '').slice(0, -1),
      }
      valuesRef.current = next
      setValues(next)
      return
    }

    if (input && !key.ctrl && !key.meta) {
      const field = fields[cursorRef.current]
      if (!field) return
      const next = {
        ...valuesRef.current,
        [field.name]: (valuesRef.current[field.name] ?? '') + input,
      }
      valuesRef.current = next
      setValues(next)
    }
  })

  const pluginLabel = `${plugin.manifest.name}${plugin.manifest.version ? `@${plugin.manifest.version}` : ''}`

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={P.primary} paddingX={1}>
      <Text color={P.primary} bold>Plugin configuration: {pluginLabel}</Text>
      {plugin.manifest.description && (
        <Text color={P.fgMuted}>{plugin.manifest.description}</Text>
      )}
      <Box height={1} />
      {fields.length === 0 ? (
        <Text color={P.fgMuted}>(no configuration fields)</Text>
      ) : (
        fields.map((f, i) => {
          const active = i === cursor
          const label = f.name + (f.required ? ' *' : '')
          return (
            <Box key={f.name} flexDirection="column">
              <Text color={active ? P.primary : P.fg}>
                {active ? '›' : ' '} {label}
                {f.description ? ` — ${f.description}` : ''}
                <Text color={P.fgMuted}> ({f.type})</Text>
              </Text>
              <Text color={active ? P.primary : P.fgMuted}>
                {'  '}{values[f.name] ?? ''}{active ? '▌' : ''}
              </Text>
            </Box>
          )
        })
      )}
      <Box height={1} />
      <Text color={P.fgMuted}>
        {fields.length === 0
          ? '⏎ continue · Esc cancel'
          : 'tab/↑↓ field · ⏎ save · esc skip plugin this session'}
      </Text>
    </Box>
  )
}
