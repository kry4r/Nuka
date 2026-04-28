// src/tui/Submenu/config/ProviderForm.tsx
//
// Phase 12 §4.7 — Provider form. Selects among existing providers and
// edits baseUrl / apiKey / selectedModel for the active one. Adding a
// new provider is OUT OF SCOPE (handled by the onboarding Wizard via
// the existing onAddProvider hook on ModelPicker).
//
// Fields (in display order):
//   active     — select among configured provider ids
//   baseUrl    — text
//   apiKey     — password (masked)
//   model      — text (free-form; the Model form has the picker)

import React, { useEffect, useState } from 'react'
import { Box, Text } from 'ink'
import { useColors } from '../../../core/theme/context'
import { Field } from './Field'
import type { FormCommonProps } from './ConfigSubmenu'

export function ProviderForm(props: FormCommonProps): React.JSX.Element {
  const colors = useColors()
  const ids = props.config.providers.map(p => p.id)
  const initialActive = props.config.active?.providerId ?? ids[0] ?? ''
  const initialProvider = props.config.providers.find(p => p.id === initialActive)
  const [activeId, setActiveId] = useState<string>(initialActive)
  const [baseUrl, setBaseUrl] = useState<string>(initialProvider?.baseUrl ?? '')
  const [apiKey, setApiKey] = useState<string>(initialProvider?.apiKey ?? '')

  // Re-sync local state when the user switches between providers.
  useEffect(() => {
    const p = props.config.providers.find(p => p.id === activeId)
    setBaseUrl(p?.baseUrl ?? '')
    setApiKey(p?.apiKey ?? '')
  }, [activeId, props.config])

  useEffect(() => {
    props.setFormSave(async () => {
      try {
        await props.onSave(obj => {
          obj.active = { providerId: activeId }
          const list: any[] = Array.isArray(obj.providers) ? obj.providers : []
          const p = list.find((x: any) => x.id === activeId)
          if (!p) throw new Error('provider not found')
          if (baseUrl) p.baseUrl = baseUrl
          if (apiKey) p.apiKey = apiKey
        })
      } catch {
        // zod path[] would tell us baseUrl vs apiKey; flash baseUrl as a
        // pragmatic default since URL validation is the most common cause.
        props.flashError('Provider:baseUrl')
      }
    })
    return () => props.setFormSave(null)
  }, [activeId, baseUrl, apiKey, props])

  if (ids.length === 0) {
    return (
      <Box flexDirection="column">
        <Text>Provider</Text>
        <Text color={colors.fgMuted}>(no providers — run the onboarding wizard)</Text>
      </Box>
    )
  }

  const fId = (i: number) => props.focused && props.fieldIdx === i

  return (
    <Box flexDirection="column">
      <Text>Provider</Text>
      <Field
        label="active"
        type="select"
        choices={ids}
        value={activeId}
        focused={fId(0)}
        errored={props.erroredField === 'Provider:active'}
        onChange={v => typeof v === 'string' && setActiveId(v)}
      />
      <Field
        label="baseUrl"
        type="text"
        value={baseUrl}
        focused={fId(1)}
        errored={props.erroredField === 'Provider:baseUrl'}
        onChange={v => typeof v === 'string' && setBaseUrl(v)}
      />
      <Field
        label="apiKey"
        type="password"
        value={apiKey}
        focused={fId(2)}
        errored={props.erroredField === 'Provider:apiKey'}
        onChange={v => typeof v === 'string' && setApiKey(v)}
      />
      <Box marginTop={1}>
        <Text color={colors.fgMuted}>
          add new providers via the onboarding wizard (/model → [+])
        </Text>
      </Box>
    </Box>
  )
}
