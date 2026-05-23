// src/tui/Submenu/settings/SettingsSubmenu.tsx
//
// Issue #4 + #6 — Claude Code style settings menu.
//
// Two-state machine:
//   { kind: 'menu' }     — single-column SubmenuList of categories.
//   { kind: 'subpage' }  — full-width form for the selected category.
//
// Model and Effort do NOT push to a subpage. Selecting them invokes
// `onRequestExternalPicker` so the parent App opens the dedicated
// ModelPicker / EffortPicker (long lists with proper ↑/↓ navigation).
// All other categories ('Providers', 'Theme', 'StatusBar', 'Vim',
// 'Plugins', 'Skills', 'Compact') push to a subpage and
// render their existing <XxxForm/> full-width.
//
// Top-level keys ({ kind: 'menu' }):
//   ↑/↓ (or j/k)  cursor (handled by SubmenuList)
//   ⏎ / →         activate category (open subpage / external picker)
//   Esc / ←       close the entire submenu (calls onClose)
//   o             open ~/.nuka/config.yaml in $EDITOR
//
// Subpage keys ({ kind: 'subpage' }):
//   ↑/↓ (or j/k)  field navigation (Field.tsx owns edit-mode keys)
//   ⏎             enter edit on focused field (Field.tsx)
//   s             save the active form
//   Esc / ←       pop back to { kind: 'menu' }

import React, { useCallback, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { useColors } from '../../../core/theme/context'
import type { Config } from '../../../core/config/schema'
import { SubmenuList, type SubmenuListItem } from '../SubmenuList'
import { ProvidersForm } from './ProvidersForm'
import { ThemeForm } from './ThemeForm'
import { StatusBarForm } from './StatusBarForm'
import { VimForm } from './VimForm'
import { PluginsForm } from './PluginsForm'
import { SkillsForm } from './SkillsForm'
import { CompactForm } from './CompactForm'

export type SettingsCategory =
  | 'Providers'
  | 'Model'
  | 'Effort'
  | 'Theme'
  | 'StatusBar'
  | 'Vim'
  | 'Plugins'
  | 'Skills'
  | 'Compact'

export const CATEGORIES: readonly SettingsCategory[] = [
  'Providers',
  'Model',
  'Effort',
  'Theme',
  'StatusBar',
  'Vim',
  'Plugins',
  'Skills',
  'Compact',
] as const

/** Categories whose activation hands off to an external picker submenu. */
const EXTERNAL_PICKER_CATEGORIES: ReadonlySet<SettingsCategory> = new Set<SettingsCategory>([
  'Model',
  'Effort',
])

export type ExternalPickerKind = 'model-picker' | 'effort-picker'

export type SettingsSubmenuProps = {
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
  /**
   * Close the entire settings submenu. Parent (App) typically wires this
   * to closeSubmenu(). When the user presses Esc/← from the top-level
   * menu list, we call this rather than relying on the App's outer Esc.
   */
  onClose?: () => void
  /**
   * Hand off Model / Effort activation to an external picker submenu.
   * Parent dispatches `open-submenu` for the corresponding picker kind.
   */
  onRequestExternalPicker?: (kind: ExternalPickerKind) => void
  /** Read-only list of loaded skills (PluginsForm / SkillsForm input). */
  loadedSkills?: { name: string; description?: string }[]
  /** Read-only list of loaded plugins. */
  loadedPlugins?: { name: string; description?: string }[]
}

type ViewState =
  | { kind: 'menu' }
  | { kind: 'subpage'; category: SettingsCategory }

/** Compute a one-line summary of the current setting for the menu list. */
function summaryFor(category: SettingsCategory, config: Config): string | undefined {
  switch (category) {
    case 'Providers': {
      const list = config.providers ?? []
      const active = list.find(p => p.id === config.active?.providerId)
      if (active) return `${active.name} (${list.length})`
      return `${list.length}`
    }
    case 'Model': {
      const active = (config.providers ?? []).find(p => p.id === config.active?.providerId)
      if (!active) return '—'
      const m = active.selectedModel ?? active.models?.[0] ?? ''
      return `${active.name} / ${m || '—'}`
    }
    case 'Effort':
      return (config as { effort?: string }).effort ?? 'medium'
    case 'Theme':
      return config.theme?.name ?? 'default'
    case 'StatusBar':
      return config.statusBar?.layout ?? 'dense'
    case 'Vim':
      return config.vim?.enabled === true ? 'on' : 'off'
    case 'Plugins': {
      const enabled = config.plugins?.enabled?.length ?? 0
      return `${enabled} enabled`
    }
    case 'Skills':
      return undefined
    case 'Compact': {
      const c = config.compact
      if (!c) return 'default'
      const retained = c.retainedMessageBudget
      return retained === undefined
        ? `keep ${c.keepTurns ?? 3}`
        : `keep ${c.keepTurns ?? 3} · tail ${retained}`
    }
  }
}

const DESCRIPTION_BY_CATEGORY: Record<SettingsCategory, string> = {
  Providers: 'Manage API providers',
  Model: 'Select active model',
  Effort: 'Reasoning depth',
  Theme: 'Color theme',
  StatusBar: 'Status line layout',
  Vim: 'Vim keybindings',
  Plugins: 'Enabled plugins',
  Skills: 'Loaded skills',
  Compact: 'Auto-compact behaviour',
}

export function SettingsSubmenu(props: SettingsSubmenuProps): React.JSX.Element {
  const colors = useColors()
  const [view, setView] = useState<ViewState>({ kind: 'menu' })
  // Field index within the current subpage form (parent owns cursor).
  const [fieldIdx, setFieldIdx] = useState(0)
  // Per-field error flash; key = `${category}:${field}`.
  const [erroredField, setErroredField] = useState<string | null>(null)
  // Remember the cursor position in the menu list so popping back keeps
  // the user oriented on the category they just visited.
  const [menuCursor, setMenuCursor] = useState(0)

  const flashError = useCallback((fieldKey: string) => {
    setErroredField(fieldKey)
    setTimeout(() => setErroredField(prev => (prev === fieldKey ? null : prev)), 1500)
  }, [])

  // A mutable ref to the active form's save-all callback. Each form sets it
  // on mount; clears on unmount.
  const formSaveRef = React.useRef<null | (() => Promise<void>)>(null)
  const setFormSave = useCallback((fn: (() => Promise<void>) | null) => {
    formSaveRef.current = fn
  }, [])

  // Bug #13: subpage `fieldIdx` was unbounded above. We accept an optional
  // form-side count via `setFormFieldCount` so subpage forms (ProvidersForm,
  // ThemeForm, etc.) can opt-in to advertising their field count and let the
  // shell clamp the cursor on ↓. Forms that don't wire this up (today: all
  // of them — those files are outside this group's editable scope) get the
  // legacy unbounded ↓ behaviour as a fallback.
  // TODO(group-D): plumb setFormFieldCount through every *Form.tsx in
  //   src/tui/Submenu/settings/*Form.tsx so the upper clamp is enforced.
  const formFieldCountRef = React.useRef<number | null>(null)
  const setFormFieldCount = useCallback((count: number | null) => {
    formFieldCountRef.current = count
  }, [])

  // Bug #15: a form field that is in edit mode (Field.tsx) needs to claim
  // ←/→ for cursor movement inside the value. SettingsSubmenu intercepts
  // ← as "back to menu", which steals key events from the form. Forms can
  // report their edit-mode flag via this setter; when set, we skip our
  // own ← handler. Unwired forms fall back to the position-based heuristic
  // below (only treat ← as back when fieldIdx === 0).
  const formEditingRef = React.useRef<boolean>(false)
  const setFormFieldEditing = useCallback((editing: boolean) => {
    formEditingRef.current = editing
  }, [])

  // Top-level (menu state) keys not already consumed by SubmenuList.
  // SubmenuList handles ↑/↓/⏎/→/Esc/←. We add 'o' for the editor escape
  // hatch, gated to menu mode.
  useInput((inputKey) => {
    if (view.kind !== 'menu') return
    if (inputKey === 'o') {
      props.onOpenEditor()
      return
    }
  }, { isActive: view.kind === 'menu' })

  // Subpage keys: 's' triggers the active form's save-all; ←/Esc pops
  // back to the menu. Field navigation (j/k/↑/↓) and edit-mode keys are
  // owned by Field.tsx.
  useInput((inputKey, key) => {
    if (view.kind !== 'subpage') return
    if (inputKey === 's') {
      formSaveRef.current?.().catch(() => { /* form handles its own flash */ })
      return
    }
    // ← pops back to menu. Esc is intercepted by App's global handler
    // (closes the entire submenu); we don't preempt it here.
    //
    // Bug #15: don't steal ← when a form field is mid-edit (Field.tsx
    // needs ← to move the value-cursor). When forms haven't reported an
    // edit flag (current state of the codebase — Field.tsx integration
    // is owned by Group D), fall back to a position heuristic: only
    // treat ← as "back" when the cursor is on the first field, where
    // the user is plausibly trying to leave the subpage.
    if (key.leftArrow) {
      if (formEditingRef.current) return
      if (fieldIdx > 0) return
      setView({ kind: 'menu' })
      setFieldIdx(0)
      return
    }
    if (key.upArrow || inputKey === 'k') {
      setFieldIdx(i => Math.max(0, i - 1))
      return
    }
    if (key.downArrow || inputKey === 'j') {
      setFieldIdx(i => {
        const cap = formFieldCountRef.current
        const next = i + 1
        if (typeof cap === 'number' && cap > 0) {
          return Math.min(next, Math.max(0, cap - 1))
        }
        // TODO(SettingsSubmenu.tsx:~245): once forms call setFormFieldCount,
        // remove this unbounded fallback. For now we still clamp ≥ 0
        // implicitly via Math.max in the up handler.
        return next
      })
      return
    }
  }, { isActive: view.kind === 'subpage' })

  // ----- menu state ------------------------------------------------------
  if (view.kind === 'menu') {
    const items: SubmenuListItem[] = CATEGORIES.map(cat => ({
      id: cat,
      label: cat,
      description: DESCRIPTION_BY_CATEGORY[cat],
      value: summaryFor(cat, props.config),
    }))

    const handleSelect = (item: SubmenuListItem, index: number) => {
      const cat = item.id as SettingsCategory
      setMenuCursor(index)
      if (EXTERNAL_PICKER_CATEGORIES.has(cat)) {
        const kind: ExternalPickerKind = cat === 'Model' ? 'model-picker' : 'effort-picker'
        props.onRequestExternalPicker?.(kind)
        // Stay in menu — App will dispatch the picker submenu, replacing
        // this view. If user re-opens /settings, we still show the menu.
        return
      }
      setFieldIdx(0)
      setView({ kind: 'subpage', category: cat })
    }

    return (
      <Box flexDirection="column">
        <SubmenuList
          items={items}
          initialCursor={menuCursor}
          onSelect={handleSelect}
          onCancel={() => props.onClose?.()}
          footer="↑↓ select · ⏎ open · o external editor · Esc close"
          focused
        />
      </Box>
    )
  }

  // ----- subpage state ---------------------------------------------------
  const category = view.category
  const formCommon: FormCommonProps = {
    config: props.config,
    onSave: props.onSave,
    focused: true,
    fieldIdx,
    setFieldIdx,
    erroredField,
    flashError,
    setFormSave,
    setFormFieldCount,
    setFormFieldEditing,
  }

  return (
    <Box flexDirection="column">
      {/*
        Bug #14: the parent App wraps SettingsSubmenu in a SubmenuFrame whose
        title bar already shows the category name. Repeating the bold
        category label here produced an awkward duplicate header. We keep
        only the muted description line as supplementary context — the
        frame title carries the category itself.
        Cross-group note: if Group A ever stops wrapping the submenu in a
        SubmenuFrame, this body should regain a standalone title row.
      */}
      <Box marginBottom={1} flexShrink={0}>
        <Text color={colors.fgMuted}>{DESCRIPTION_BY_CATEGORY[category]}</Text>
      </Box>

      {category === 'Providers' && <ProvidersForm {...formCommon} />}
      {category === 'Theme' && <ThemeForm {...formCommon} />}
      {category === 'StatusBar' && <StatusBarForm {...formCommon} />}
      {category === 'Vim' && <VimForm {...formCommon} />}
      {category === 'Plugins' && (
        <PluginsForm {...formCommon} loadedPlugins={props.loadedPlugins ?? []} />
      )}
      {category === 'Skills' && (
        <SkillsForm {...formCommon} loadedSkills={props.loadedSkills ?? []} />
      )}
      {category === 'Compact' && <CompactForm {...formCommon} />}

      <Box marginTop={1}>
        <Text color={colors.fgMuted}>
          ← back · ⏎ edit · s save · Esc close
        </Text>
      </Box>
    </Box>
  )
}

/**
 * Common props every form receives from SettingsSubmenu. Forms own their
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
  /**
   * Optional: report the form's total field count so the shell can clamp
   * `fieldIdx` on ↓. Pass null on unmount. Forms that don't call this opt
   * out of the upper-bound clamp (legacy unbounded behaviour).
   */
  setFormFieldCount?: (count: number | null) => void
  /**
   * Optional: tell the shell whether the focused field is currently in
   * edit mode (Field.tsx). When true, the shell will not steal ← as
   * "back to menu" — letting the field consume cursor-movement keys.
   */
  setFormFieldEditing?: (editing: boolean) => void
}
