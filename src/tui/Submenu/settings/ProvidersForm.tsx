// src/tui/Submenu/settings/ProvidersForm.tsx
//
// Phase 13 §4.5 — Providers form (add/edit/delete + activate). Replaces
// the read-only ProviderForm from Phase 12. Layout:
//
//   Top: providers list, one row per provider:
//        ▸ <name> · <id> · <baseUrl>      <- highlighted row (cursor)
//          <name> · <id> · <baseUrl>
//
//   Footer keys (when in list mode):
//        a 添加 · e 编辑 · d 删除 · ⏎ 设为 active · Esc 关闭
//
//   Inline editor (e or a):
//        id (readonly when editing existing; required + unique when adding)
//        baseUrl  (text)
//        apiKey   (password)
//        format   (select: openai | anthropic)
//        model    (text — selectedModel)
//
// Phase 14 will add re-ordering; not in scope here.

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { useColors } from '../../../core/theme/context'
import { Field } from './Field'
import type { FormCommonProps } from './SettingsSubmenu'
import type { ProviderConfig } from '../../../core/config/schema'

type Mode =
  | { kind: 'list' }
  | { kind: 'edit'; index: number; isNew: boolean }
  | { kind: 'confirm-delete'; index: number }

type DraftProvider = {
  id: string
  name: string
  format: 'openai' | 'anthropic'
  baseUrl: string
  apiKey: string
  selectedModel: string
}

const FORMATS: ('openai' | 'anthropic')[] = ['openai', 'anthropic']

function toDraft(p: ProviderConfig | undefined): DraftProvider {
  return {
    id: p?.id ?? '',
    name: p?.name ?? p?.id ?? '',
    format: (p?.format ?? 'openai') as 'openai' | 'anthropic',
    baseUrl: p?.baseUrl ?? '',
    apiKey: p?.apiKey ?? '',
    selectedModel: p?.selectedModel ?? '',
  }
}

function applyDraft(target: any, d: DraftProvider): void {
  target.id = d.id
  target.name = d.name || d.id
  target.format = d.format
  target.baseUrl = d.baseUrl
  if (d.apiKey) target.apiKey = d.apiKey
  if (d.selectedModel) target.selectedModel = d.selectedModel
  if (!Array.isArray(target.models)) target.models = []
}

function providerTitle(p: ProviderConfig | undefined): string {
  if (!p) return ''
  const name = p.name?.trim() || p.id
  return name === p.id ? p.id : `${name} · ${p.id}`
}

export function ProvidersForm(props: FormCommonProps): React.JSX.Element {
  const colors = useColors()
  // Local mirror of the provider list so edits show up immediately.
  const [providers, setProviders] = useState<ProviderConfig[]>(() =>
    (props.config.providers ?? []).map(p => ({ ...p })) as ProviderConfig[],
  )
  const [activeId, setActiveId] = useState<string>(
    props.config.active?.providerId ?? providers[0]?.id ?? '',
  )
  // Cursor for the providers list (top mode).
  const [cursor, setCursor] = useState(0)
  // Mode: list / edit / confirm-delete.
  const [mode, setMode] = useState<Mode>({ kind: 'list' })
  // Draft buffer + sub-cursor for inline editor.
  const [draft, setDraft] = useState<DraftProvider>(toDraft(undefined))
  const [editFieldIdx, setEditFieldIdx] = useState(0)

  // Re-sync from upstream config when it changes.
  useEffect(() => {
    setProviders((props.config.providers ?? []).map(p => ({ ...p })) as ProviderConfig[])
    setActiveId(props.config.active?.providerId ?? '')
  }, [props.config])

  // Clamp cursor.
  useEffect(() => {
    if (cursor >= providers.length) setCursor(Math.max(0, providers.length - 1))
  }, [providers.length, cursor])

  // ---------------- save plumbing ----------------
  const persist = useCallback(
    async (mutated: ProviderConfig[], nextActiveId: string) => {
      try {
        await props.onSave(obj => {
          obj.providers = mutated.map(p => ({ ...p }))
          obj.active = { providerId: nextActiveId || mutated[0]?.id || '' }
        })
      } catch {
        props.flashError('Providers:save')
      }
    },
    [props],
  )

  // Wire up the shell's "s" save: persist current providers/activeId.
  useEffect(() => {
    props.setFormSave(async () => {
      await persist(providers, activeId)
    })
    return () => props.setFormSave(null)
  }, [providers, activeId, persist, props])

  // ---------------- input handling ----------------
  const enabled = props.focused
  // Number of editable fields when editing: id?, baseUrl, apiKey, format, model
  const fieldsCount = (isNew: boolean) => (isNew ? 5 : 4)

  useInput((inputKey, key) => {
    if (!enabled) return

    // -------- confirm delete --------
    if (mode.kind === 'confirm-delete') {
      if (inputKey === 'y' || inputKey === 'Y') {
        const idx = mode.index
        const next = providers.slice(0, idx).concat(providers.slice(idx + 1))
        const nextActive = activeId && next.some(p => p.id === activeId)
          ? activeId
          : next[0]?.id ?? ''
        setProviders(next)
        setActiveId(nextActive)
        setMode({ kind: 'list' })
        setCursor(c => Math.max(0, Math.min(c, next.length - 1)))
        void persist(next, nextActive)
        return
      }
      if (inputKey === 'n' || inputKey === 'N' || key.escape) {
        setMode({ kind: 'list' })
        return
      }
      return
    }

    // -------- edit mode --------
    if (mode.kind === 'edit') {
      const isNew = mode.isNew
      const total = fieldsCount(isNew)
      // Field-level keys (j/k/↑/↓) navigate sub-cursor when not in inner edit.
      // The Field component handles its own Enter/edit lifecycle; the form's
      // useInput is co-located but Ink fires both. We only act on j/k/up/down
      // and Esc/'s' here — Enter/printable chars belong to the focused Field.
      if (key.upArrow || inputKey === 'k') {
        setEditFieldIdx(i => Math.max(0, i - 1))
        return
      }
      if (key.downArrow || inputKey === 'j') {
        setEditFieldIdx(i => Math.min(total - 1, i + 1))
        return
      }
      if (key.escape) {
        // Cancel edit, return to list.
        setMode({ kind: 'list' })
        return
      }
      if (inputKey === 's') {
        // Validate on save.
        const id = draft.id.trim()
        if (id.length === 0) {
          props.flashError('Providers:id')
          return
        }
        if (isNew) {
          if (providers.some(p => p.id === id)) {
            props.flashError('Providers:id')
            return
          }
        }
        // Build the new providers array.
        let next: ProviderConfig[]
        if (isNew) {
          const nextProvider: any = {}
          applyDraft(nextProvider, { ...draft, id })
          next = providers.concat(nextProvider)
        } else {
          next = providers.map((p, i) => {
            if (i !== mode.index) return p
            const merged: any = { ...p }
            applyDraft(merged, { ...draft, id: p.id })
            return merged
          })
        }
        setProviders(next)
        const nextActive = activeId || next[0]?.id || ''
        setActiveId(nextActive)
        setMode({ kind: 'list' })
        void persist(next, nextActive)
        return
      }
      return
    }

    // -------- list mode --------
    if (key.upArrow || inputKey === 'k') {
      setCursor(c => Math.max(0, c - 1))
      return
    }
    if (key.downArrow || inputKey === 'j') {
      setCursor(c => Math.min(Math.max(0, providers.length - 1), c + 1))
      return
    }
    if (inputKey === 'a') {
      setDraft(toDraft(undefined))
      setEditFieldIdx(0)
      setMode({ kind: 'edit', index: providers.length, isNew: true })
      return
    }
    if (inputKey === 'e') {
      if (providers.length === 0) return
      const p = providers[cursor]
      if (!p) return
      setDraft(toDraft(p))
      setEditFieldIdx(0)
      setMode({ kind: 'edit', index: cursor, isNew: false })
      return
    }
    if (inputKey === 'd') {
      if (providers.length === 0) return
      setMode({ kind: 'confirm-delete', index: cursor })
      return
    }
    if (key.return) {
      const p = providers[cursor]
      if (!p) return
      setActiveId(p.id)
      void persist(providers, p.id)
      return
    }
  }, { isActive: enabled })

  // ---------------- render ----------------
  const inEdit = mode.kind === 'edit'
  const inConfirm = mode.kind === 'confirm-delete'

  // Subfield indices (offset by 1 in `add` because id is editable then).
  const subIdx = (i: number) => editFieldIdx === i

  const editor = useMemo(() => {
    if (mode.kind !== 'edit') return null
    const isNew = mode.isNew
    let i = 0
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color={colors.primary}>{isNew ? '+ Add provider' : `· Edit ${providerTitle(providers[mode.index])}`}</Text>
        {isNew ? (
          <Field
            label="id"
            type="text"
            value={draft.id}
            focused={subIdx(i)}
            errored={props.erroredField === 'Providers:id'}
            onChange={v => typeof v === 'string' && setDraft(d => ({ ...d, id: v }))}
          />
        ) : (
          <Field
            label="id"
            type="text"
            value={draft.id}
            disabled
          />
        )}
        {(() => { i += 1; return null })()}
        <Field
          label="baseUrl"
          type="text"
          value={draft.baseUrl}
          focused={subIdx(i)}
          errored={props.erroredField === 'Providers:baseUrl'}
          onChange={v => typeof v === 'string' && setDraft(d => ({ ...d, baseUrl: v }))}
        />
        {(() => { i += 1; return null })()}
        <Field
          label="apiKey"
          type="password"
          value={draft.apiKey}
          focused={subIdx(i)}
          errored={props.erroredField === 'Providers:apiKey'}
          onChange={v => typeof v === 'string' && setDraft(d => ({ ...d, apiKey: v }))}
        />
        {(() => { i += 1; return null })()}
        <Field
          label="format"
          type="select"
          choices={FORMATS as unknown as string[]}
          value={draft.format}
          focused={subIdx(i)}
          errored={props.erroredField === 'Providers:format'}
          onChange={v => typeof v === 'string' && (FORMATS as readonly string[]).includes(v)
            && setDraft(d => ({ ...d, format: v as 'openai' | 'anthropic' }))}
        />
        {(() => { i += 1; return null })()}
        <Field
          label="model"
          type="text"
          value={draft.selectedModel}
          focused={subIdx(i)}
          errored={props.erroredField === 'Providers:selectedModel'}
          onChange={v => typeof v === 'string' && setDraft(d => ({ ...d, selectedModel: v }))}
        />
        <Box marginTop={1}>
          <Text color={colors.fgMuted}>j/k 切换字段 · ⏎ 编辑该字段 · s 保存 · Esc 取消</Text>
        </Box>
      </Box>
    )
  }, [mode, draft, props.erroredField, colors, editFieldIdx])

  return (
    <Box flexDirection="column">
      <Text>Providers · {providers.length}</Text>
      {providers.length === 0 && !inEdit && (
        <Text color={colors.fgMuted}>(no providers — press `a` to add)</Text>
      )}
      {!inEdit && providers.map((p, i) => {
        const selected = i === cursor && !inConfirm
        const isActive = p.id === activeId
        const sigil = selected ? '▸' : ' '
        const tag = isActive ? ' (active)' : ''
        return (
          <Box key={p.id + i}>
            <Text
              backgroundColor={selected ? colors.primaryDeep : undefined}
              color={selected ? colors.fg : colors.fg}
              bold={isActive}
            >
              {sigil} {providerTitle(p)} · {p.baseUrl}{tag}
            </Text>
          </Box>
        )
      })}
      {inConfirm && (
        <Box marginTop={1}>
          <Text color={colors.warn}>
            Delete provider `{providerTitle(providers[mode.index])}`? (y/n)
          </Text>
        </Box>
      )}
      {editor}
      {!inEdit && !inConfirm && (
        <Box marginTop={1}>
          <Text color={colors.fgMuted}>a 添加 · e 编辑 · d 删除 · ⏎ 设为 active · Esc 关闭</Text>
        </Box>
      )}
    </Box>
  )
}
