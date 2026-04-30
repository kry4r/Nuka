// src/tui/Submenu/settings/ModelForm.tsx
//
// Phase 12 §4.7 — model selector. Lists models known to the active
// provider; the user can pick one (it becomes provider.selectedModel)
// or type a free-form name. Adding new providers is OUT OF SCOPE
// (use the Wizard); switching providers happens in ProviderForm.

import React, { useEffect, useState } from 'react'
import { Box, Text } from 'ink'
import { useColors } from '../../../core/theme/context'
import { Field } from './Field'
import type { FormCommonProps } from './SettingsSubmenu'

export function ModelForm(props: FormCommonProps): React.JSX.Element {
  const colors = useColors()
  const activeId = props.config.active?.providerId ?? ''
  const provider = props.config.providers.find(p => p.id === activeId)
  const initial = provider?.selectedModel ?? provider?.models?.[0] ?? ''
  const [model, setModel] = useState<string>(initial)

  useEffect(() => {
    const p = props.config.providers.find(p => p.id === (props.config.active?.providerId ?? ''))
    setModel(p?.selectedModel ?? p?.models?.[0] ?? '')
  }, [props.config])

  useEffect(() => {
    props.setFormSave(async () => {
      if (!provider) { props.flashError('Model:selectedModel'); return }
      try {
        await props.onSave(obj => {
          const list: any[] = Array.isArray(obj.providers) ? obj.providers : []
          const p = list.find((x: any) => x.id === activeId)
          if (!p) throw new Error('provider not found')
          p.selectedModel = model
          if (model && !p.models?.includes(model)) {
            p.models = [...(p.models ?? []), model]
          }
        })
      } catch {
        props.flashError('Model:selectedModel')
      }
    })
    return () => props.setFormSave(null)
  }, [model, provider, activeId, props])

  if (!provider) {
    return (
      <Box flexDirection="column">
        <Text>Model</Text>
        <Text color={colors.fgMuted}>(no active provider — set one in Provider)</Text>
      </Box>
    )
  }

  const choices = provider.models && provider.models.length > 0
    ? provider.models
    : [model || provider.selectedModel || '']

  return (
    <Box flexDirection="column">
      <Text>Model · {provider.name}</Text>
      <Field
        label="selectedModel"
        type="select"
        choices={choices}
        value={model}
        focused={props.focused && props.fieldIdx === 0}
        errored={props.erroredField === 'Model:selectedModel'}
        onChange={v => typeof v === 'string' && setModel(v)}
      />
      <Box marginTop={1}>
        <Text color={colors.fgMuted}>
          {provider.models?.length ?? 0} known · use /model picker to refresh
        </Text>
      </Box>
    </Box>
  )
}
