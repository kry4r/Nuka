// src/tui/dialogs/ElicitationDialog.tsx
import React, { useState, useMemo, useRef } from 'react'
import { Box, Text, useInput } from 'ink'
import { defaultPalette as P } from '../theme'
import type {
  ElicitationPayload,
  ElicitationResult,
} from '../../core/mcp/elicitation'

type SchemaProperty = {
  title?: string
  description?: string
  type?: string
}

function extractFieldNames(schema: unknown): string[] {
  if (!schema || typeof schema !== 'object') return []
  const s = schema as { properties?: Record<string, unknown> }
  if (!s.properties || typeof s.properties !== 'object') return []
  return Object.keys(s.properties)
}

function fieldMeta(schema: unknown, name: string): SchemaProperty {
  if (!schema || typeof schema !== 'object') return {}
  const s = schema as { properties?: Record<string, unknown> }
  const prop = s.properties?.[name]
  if (!prop || typeof prop !== 'object') return {}
  return prop as SchemaProperty
}

export function ElicitationDialog(props: {
  payload: ElicitationPayload
  onResolve: (r: ElicitationResult) => void
}): React.JSX.Element {
  const fields = useMemo(
    () => extractFieldNames(props.payload.requestedSchema),
    [props.payload.requestedSchema],
  )
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map(f => [f, ''])),
  )
  // Keep a mirror in a ref so the useInput callback can observe synchronous
  // character-by-character updates before the next React render commits.
  const valuesRef = useRef<Record<string, string>>(values)
  const [cursor, setCursor] = useState(0)
  const cursorRef = useRef<number>(0)

  const isUrlMode = props.payload.mode === 'url'

  useInput((input, key) => {
    if (key.escape) {
      props.onResolve({ action: 'cancel' })
      return
    }
    if (key.ctrl && input === 'd') {
      props.onResolve({ action: 'decline' })
      return
    }
    if (isUrlMode) {
      if (key.return) {
        // In URL mode accept means "I opened it"
        props.onResolve({ action: 'accept', content: {} })
      }
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
      props.onResolve({ action: 'accept', content: { ...valuesRef.current } })
      return
    }
    if (key.backspace || key.delete) {
      const field = fields[cursorRef.current]
      if (!field) return
      const next = { ...valuesRef.current, [field]: (valuesRef.current[field] ?? '').slice(0, -1) }
      valuesRef.current = next
      setValues(next)
      return
    }
    // Plain character input
    if (input && !key.ctrl && !key.meta) {
      const field = fields[cursorRef.current]
      if (!field) return
      const next = { ...valuesRef.current, [field]: (valuesRef.current[field] ?? '') + input }
      valuesRef.current = next
      setValues(next)
    }
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={P.primary} paddingX={1}>
      <Text color={P.primary} bold>MCP elicitation</Text>
      <Text color={P.fg}>{props.payload.message}</Text>
      <Box height={1} />
      {isUrlMode ? (
        <Box flexDirection="column">
          <Text color={P.accent}>Open URL to continue:</Text>
          <Text color={P.muted}>{props.payload.url ?? '(no url)'}</Text>
          <Box height={1} />
          <Text color={P.muted}>⏎ mark accepted · ctrl-d decline · esc cancel</Text>
        </Box>
      ) : fields.length === 0 ? (
        <Box flexDirection="column">
          <Text color={P.muted}>(no input fields required)</Text>
          <Box height={1} />
          <Text color={P.muted}>⏎ accept · ctrl-d decline · esc cancel</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {fields.map((f, i) => {
            const meta = fieldMeta(props.payload.requestedSchema, f)
            const label = meta.title ?? f
            const active = i === cursor
            return (
              <Box key={f} flexDirection="column">
                <Text color={active ? P.primary : P.fg}>
                  {active ? '›' : ' '} {label}{meta.description ? ` — ${meta.description}` : ''}
                </Text>
                <Text color={active ? P.primary : P.muted}>
                  {'  '}{values[f] ?? ''}{active ? '▌' : ''}
                </Text>
              </Box>
            )
          })}
          <Box height={1} />
          <Text color={P.muted}>tab/↑↓ field · ⏎ accept · ctrl-d decline · esc cancel</Text>
        </Box>
      )}
    </Box>
  )
}
