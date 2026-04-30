// src/tui/Submenu/settings/PluginsForm.tsx
//
// Phase 13 §4.5 — multi-select toggle for `config.plugins.enabled`.
// Renders every loaded plugin as a checklist row:
//
//   [x] <name>  <description>
//   [ ] <name>  <description>
//
// j/k (↑/↓) move the cursor; Space toggles enabled state; `s` (handled
// by SettingsSubmenu) saves the resulting `enabled` array via
// saveConfigPatch. If `loadedPlugins` is empty we render a placeholder.

import React, { useCallback, useEffect, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { useColors } from '../../../core/theme/context'
import type { FormCommonProps } from './SettingsSubmenu'

export type PluginsFormProps = FormCommonProps & {
  loadedPlugins: { name: string; description?: string }[]
}

export function PluginsForm(props: PluginsFormProps): React.JSX.Element {
  const colors = useColors()
  const list = props.loadedPlugins ?? []
  const [enabled, setEnabled] = useState<Set<string>>(
    () => new Set(props.config.plugins?.enabled ?? []),
  )
  const [cursor, setCursor] = useState(0)

  // Sync from upstream config.
  useEffect(() => {
    setEnabled(new Set(props.config.plugins?.enabled ?? []))
  }, [props.config])

  // Clamp cursor.
  useEffect(() => {
    if (cursor >= list.length) setCursor(Math.max(0, list.length - 1))
  }, [list.length, cursor])

  const toggleAt = useCallback(
    (i: number) => {
      const target = list[i]
      if (!target) return
      setEnabled(prev => {
        const next = new Set(prev)
        if (next.has(target.name)) next.delete(target.name)
        else next.add(target.name)
        return next
      })
    },
    [list],
  )

  // Save plumbing.
  useEffect(() => {
    props.setFormSave(async () => {
      try {
        // Persist in the order plugins are listed for stable diffs.
        const ordered = list.filter(p => enabled.has(p.name)).map(p => p.name)
        // Also keep any orphan entries from config (plugins enabled in YAML
        // but not in `loadedPlugins`).
        const orphans = Array.from(enabled).filter(n => !list.some(p => p.name === n))
        const all = ordered.concat(orphans)
        await props.onSave(obj => {
          obj.plugins = { ...(obj.plugins ?? {}), enabled: all }
        })
      } catch {
        props.flashError('Plugins:enabled')
      }
    })
    return () => props.setFormSave(null)
  }, [enabled, list, props])

  // Input.
  const enabledFocus = props.focused
  useInput((inputKey, key) => {
    if (!enabledFocus) return
    if (list.length === 0) return
    if (key.upArrow || inputKey === 'k') {
      setCursor(c => Math.max(0, c - 1))
      return
    }
    if (key.downArrow || inputKey === 'j') {
      setCursor(c => Math.min(list.length - 1, c + 1))
      return
    }
    if (inputKey === ' ') {
      toggleAt(cursor)
      return
    }
  }, { isActive: enabledFocus })

  if (list.length === 0) {
    return (
      <Box flexDirection="column">
        <Text>Plugins</Text>
        <Text color={colors.fgMuted}>(no plugins detected)</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Text>Plugins · {enabled.size}/{list.length} enabled</Text>
      {list.map((p, i) => {
        const isOn = enabled.has(p.name)
        const cursored = props.focused && i === cursor
        const box = isOn ? '[x]' : '[ ]'
        const sigil = cursored ? '▸ ' : '  '
        const lineColor = cursored ? colors.primary : colors.fg
        return (
          <Box key={p.name + i}>
            <Text color={lineColor}>{sigil}{box} {p.name}</Text>
            {p.description && (
              <Box marginLeft={2}>
                <Text color={colors.fgMuted}>{p.description}</Text>
              </Box>
            )}
          </Box>
        )
      })}
      <Box marginTop={1}>
        <Text color={colors.fgMuted}>space 切换 · s 保存 · Esc 关闭</Text>
      </Box>
    </Box>
  )
}
