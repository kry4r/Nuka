// src/tui/Submenu/config/ConfigSubmenu.tsx
//
// Phase 12 §4.7 — Config submenu shell. Replaces the old ConfigEditor's
// "punt to $EDITOR" UX with a left-rail (18-col, fixed) list of
// categories + right-pane form. j/k (or ↑/↓) cycles category; the
// selected category renders its <CategoryForm/> on the right.
//
// Top-level keys (no field focused yet):
//   j / ↓        next category
//   k / ↑        previous category
//   ⏎ / →        descend into the form (focus first field)
//   o            open ~/.nuka/config.yaml in $EDITOR (closes submenu)
//   s            save the entire config via saveConfigPatch
//   Esc          close submenu (handled by App)
//
// Inside a form, each field can be edit/toggled — see Field.tsx. The
// form's own pending state lives in `pendingByCategory` here so jumping
// across categories doesn't lose unsaved edits.

import React, { useCallback, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { useColors } from '../../../core/theme/context'
import type { Config } from '../../../core/config/schema'
import { ProviderForm } from './ProviderForm'
import { ModelForm } from './ModelForm'
import { ThemeForm } from './ThemeForm'
import { StatusBarForm } from './StatusBarForm'
import { VimForm } from './VimForm'
import { PluginsForm } from './PluginsForm'
import { SkillsForm } from './SkillsForm'
import { WelcomeForm } from './WelcomeForm'
import { CompactForm } from './CompactForm'

export type ConfigCategory =
  | 'Provider'
  | 'Model'
  | 'Theme'
  | 'StatusBar'
  | 'Vim'
  | 'Plugins'
  | 'Skills'
  | 'Welcome'
  | 'Compact'

export const CATEGORIES: readonly ConfigCategory[] = [
  'Provider',
  'Model',
  'Theme',
  'StatusBar',
  'Vim',
  'Plugins',
  'Skills',
  'Welcome',
  'Compact',
] as const

export type ConfigSubmenuProps = {
  /**
   * Live config — forms render bound values from this object. After save,
   * the App's onConfigPatch mutates this object in place and bumps a tick
   * so the Status panel re-renders against the new layout etc.
   */
  config: Config
  /**
   * Apply a patch to the in-memory config (mutator) and persist via
   * saveConfigPatch. Throws on validation failure; the form catches and
   * flashes the offending field.
   */
  onSave: (mutate: (obj: any) => void) => Promise<void>
  /** Open ~/.nuka/config.yaml in $EDITOR. Closes the submenu after. */
  onOpenEditor: () => void
  /** Read-only list of loaded skills (PluginsForm / SkillsForm input). */
  loadedSkills?: { name: string; description?: string }[]
  /** Read-only list of loaded plugins. */
  loadedPlugins?: { name: string; description?: string }[]
}

export function ConfigSubmenu(props: ConfigSubmenuProps): React.JSX.Element {
  const colors = useColors()
  const [cursor, setCursor] = useState(0)
  // True when keyboard focus has descended into the right pane.
  const [inForm, setInForm] = useState(false)
  // Field index within the current form (parent owns cursor).
  const [fieldIdx, setFieldIdx] = useState(0)
  // Per-field error flash; key = `${category}:${field}`.
  const [erroredField, setErroredField] = useState<string | null>(null)

  const category = CATEGORIES[cursor]!

  // Move cursor up/down in the rail (top level) or between fields (in form).
  const navList = useCallback((dir: -1 | 1) => {
    if (inForm) {
      setFieldIdx(i => Math.max(0, i + dir))
    } else {
      setCursor(c => {
        const n = c + dir
        if (n < 0) return 0
        if (n >= CATEGORIES.length) return CATEGORIES.length - 1
        return n
      })
    }
  }, [inForm])

  const flashError = useCallback((fieldKey: string) => {
    setErroredField(fieldKey)
    setTimeout(() => setErroredField(prev => (prev === fieldKey ? null : prev)), 1500)
  }, [])

  useInput((inputKey, key) => {
    // The Field component owns its own input handling while focused; the
    // shell only handles category/field navigation and form-level keys.
    // Filter: only act when no field is in edit mode. We approximate this by
    // ignoring printable characters that aren't j/k/o/s and arrow/Enter.
    if (key.upArrow || inputKey === 'k') {
      navList(-1)
      return
    }
    if (key.downArrow || inputKey === 'j') {
      navList(1)
      return
    }
    if (key.rightArrow && !inForm) {
      // Descend into the form
      setInForm(true)
      setFieldIdx(0)
      return
    }
    if (key.leftArrow && inForm) {
      setInForm(false)
      return
    }
    if (key.return && !inForm) {
      setInForm(true)
      setFieldIdx(0)
      return
    }
    if (inputKey === 'o' && !inForm) {
      props.onOpenEditor()
      return
    }
    // 's' save is delegated to the active form via render-prop saveCallback
    // (Forms call onSave themselves; the shell still listens for 's' as a
    // shortcut that triggers the form's own saveAll. Each form exposes a
    // ref-less callback through `formSaveRef.current`.)
    if (inputKey === 's' && inForm) {
      formSaveRef.current?.().catch(() => { /* form handles its own flash */ })
      return
    }
  })

  // A mutable ref to the active form's save-all callback. Each form sets it
  // on mount; clears on unmount.
  const formSaveRef = React.useRef<null | (() => Promise<void>)>(null)
  const setFormSave = useCallback((fn: (() => Promise<void>) | null) => {
    formSaveRef.current = fn
  }, [])

  // Common props passed to every form.
  const formCommon = {
    config: props.config,
    onSave: props.onSave,
    focused: inForm,
    fieldIdx,
    setFieldIdx,
    erroredField,
    flashError,
    setFormSave,
  }

  return (
    <Box flexDirection="row">
      {/* Left rail — fixed 18 cols. */}
      <Box width={18} flexDirection="column" paddingRight={1}>
        {CATEGORIES.map((c, i) => {
          const selected = i === cursor
          const sigil = selected ? '▸' : ' '
          return (
            <Text
              key={c}
              color={selected ? (inForm ? colors.fgMuted : colors.primary) : colors.fg}
              bold={selected && !inForm}
            >
              {sigil} {c}
            </Text>
          )
        })}
        <Box marginTop={1}>
          <Text color={colors.accentInfo}>{inForm ? '↑↓ field · ← back' : 'j/k · ⏎ open'}</Text>
        </Box>
      </Box>

      {/* Right pane. */}
      <Box flexGrow={1} flexDirection="column" paddingLeft={1}>
        {category === 'Provider' && <ProviderForm {...formCommon} />}
        {category === 'Model' && <ModelForm {...formCommon} />}
        {category === 'Theme' && <ThemeForm {...formCommon} />}
        {category === 'StatusBar' && <StatusBarForm {...formCommon} />}
        {category === 'Vim' && <VimForm {...formCommon} />}
        {category === 'Plugins' && (
          <PluginsForm {...formCommon} loadedPlugins={props.loadedPlugins ?? []} />
        )}
        {category === 'Skills' && (
          <SkillsForm {...formCommon} loadedSkills={props.loadedSkills ?? []} />
        )}
        {category === 'Welcome' && <WelcomeForm {...formCommon} />}
        {category === 'Compact' && <CompactForm {...formCommon} />}
        <Box marginTop={1}>
          <Text color={colors.fgMuted}>
            ⏎ 编辑   s 保存   o 外部编辑器   Esc 关闭
          </Text>
        </Box>
      </Box>
    </Box>
  )
}

/**
 * Common props every form receives from ConfigSubmenu. Forms own their
 * pending-edits state internally; the shell only owns category/field
 * navigation and per-field error flash.
 */
export type FormCommonProps = {
  config: Config
  onSave: (mutate: (obj: any) => void) => Promise<void>
  /** True when keyboard focus has descended into this form. */
  focused: boolean
  /** Currently-highlighted field index within this form. */
  fieldIdx: number
  setFieldIdx: (i: number) => void
  /** Field key flashing error, e.g. "Compact:keepTurns"; null when none. */
  erroredField: string | null
  /** Trigger an error flash for the supplied field key. */
  flashError: (fieldKey: string) => void
  /** Set the active form's save-all callback so 's' can dispatch it. */
  setFormSave: (fn: (() => Promise<void>) | null) => void
}
