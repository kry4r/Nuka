// src/tui/Submenu/config/PluginsForm.tsx
//
// Phase 12 §4.7 / §8 — read-only listing of currently enabled plugins.
// Editing the enabled list is OUT OF SCOPE for Phase 12; the user edits
// the YAML directly via `o` (or runs `nuka plugin add/enable`).

import React, { useEffect } from 'react'
import { Box, Text } from 'ink'
import { useColors } from '../../../core/theme/context'
import type { FormCommonProps } from './ConfigSubmenu'

export type PluginsFormProps = FormCommonProps & {
  loadedPlugins: { name: string; description?: string }[]
}

export function PluginsForm(props: PluginsFormProps): React.JSX.Element {
  const colors = useColors()
  // Prefer live loaded-plugins list when present; fall back to the
  // enabled list from the config file.
  const fallback: { name: string; description?: string }[] = (props.config.plugins?.enabled ?? []).map(name => ({ name }))
  const list = props.loadedPlugins.length > 0 ? props.loadedPlugins : fallback

  useEffect(() => {
    props.setFormSave(async () => { /* read-only */ })
    return () => props.setFormSave(null)
  }, [props])

  return (
    <Box flexDirection="column">
      <Text>Plugins · {list.length} loaded</Text>
      {list.length === 0 && (
        <Text color={colors.fgMuted}>(no plugins enabled)</Text>
      )}
      {list.map((p, i) => (
        <Box key={p.name + i}>
          <Box width={20}>
            <Text color={colors.fg}>{p.name}</Text>
          </Box>
          {p.description && <Text color={colors.fgMuted}>{p.description}</Text>}
        </Box>
      ))}
      <Box marginTop={1}>
        <Text color={colors.fgMuted}>read-only · editing list is out of scope (spec §8)</Text>
      </Box>
    </Box>
  )
}
