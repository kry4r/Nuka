import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'
import type { ProviderConfig } from '../../core/config/schema'
import { useColors } from '../../core/theme/context'
import { useTerminalSize } from '../hooks/useTerminalSize'

// Sliding window for the models list — same shape as SlashCard/CommandList.
const MODEL_WINDOW = 12

type Stage =
  | { kind: 'providers' }
  | { kind: 'models'; providerId: string }

export type ModelPickerProps = {
  providers: ProviderConfig[]
  /** Active session model — used to mark `[●]` when also shortlisted. */
  activeProviderId?: string
  activeModel?: string
  /** Persist + mirror config: mutator runs against the YAML config object. */
  onSave: (mutate: (obj: any) => void) => Promise<void>
  /** Called after the user activates a model — switches the session. */
  onSelect: (providerId: string, model: string) => void
  onAddProvider: () => void
  /** Fetches /v1/models for a provider. */
  onFetchRemote: (providerId: string) => Promise<string[]>
  onCancel: () => void
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'loaded'; models: string[]; remote: boolean; error?: string }

export function ModelPicker(props: ModelPickerProps): React.JSX.Element {
  const colors = useColors()
  const { columns } = useTerminalSize()
  const [stage, setStage] = useState<Stage>({ kind: 'providers' })
  const [cursor, setCursor] = useState(0)

  const currentProvider =
    stage.kind === 'models'
      ? props.providers.find(p => p.id === stage.providerId) ?? null
      : null

  const [load, setLoad] = useState<LoadState>({ kind: 'loaded', models: [], remote: false })
  const [shortlist, setShortlist] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState<string | undefined>(undefined)

  // Stage 2 entry — fetch remote /v1/models. Falls back to the static
  // shortlist on failure with a small inline error line.
  useEffect(() => {
    if (stage.kind !== 'models' || !currentProvider) return
    let cancelled = false
    setShortlist([...(currentProvider.models ?? [])])
    setSelectedModel(currentProvider.selectedModel)
    setCursor(0)
    setLoad({ kind: 'loading' })
    void (async () => {
      try {
        const remote = await props.onFetchRemote(currentProvider.id)
        if (cancelled) return
        if (remote.length === 0) {
          setLoad({ kind: 'loaded', models: [...(currentProvider.models ?? [])], remote: false })
          return
        }
        setLoad({ kind: 'loaded', models: remote, remote: true })
      } catch (err) {
        if (cancelled) return
        setLoad({
          kind: 'loaded',
          models: [...(currentProvider.models ?? [])],
          remote: false,
          error: (err as Error).message ?? 'fetch failed',
        })
      }
    })()
    return () => { cancelled = true }
  }, [stage, currentProvider, props])

  const persistShortlist = useCallback(async (providerId: string, next: string[]) => {
    await props.onSave((obj: any) => {
      const list: any[] = Array.isArray(obj.providers) ? obj.providers : []
      const p = list.find((x: any) => x.id === providerId)
      if (p) p.models = next
    })
  }, [props])

  const persistActive = useCallback(async (providerId: string, model: string, ensureShortlist: string[]) => {
    await props.onSave((obj: any) => {
      const list: any[] = Array.isArray(obj.providers) ? obj.providers : []
      const p = list.find((x: any) => x.id === providerId)
      if (p) {
        p.models = ensureShortlist
        p.selectedModel = model
      }
      obj.active = { providerId }
    })
  }, [props])

  const stateRef = useRef({ stage, cursor, load, shortlist, selectedModel, currentProvider })
  stateRef.current = { stage, cursor, load, shortlist, selectedModel, currentProvider }

  const inputHandler = useCallback((input: string, key: import('ink').Key) => {
    const s = stateRef.current
    if (s.stage.kind === 'providers') {
      const total = props.providers.length + 1 // +1 for "Add provider…"
      if (key.upArrow) setCursor(c => Math.max(0, c - 1))
      else if (key.downArrow) setCursor(c => Math.min(total - 1, c + 1))
      else if (key.return) {
        if (s.cursor === props.providers.length) {
          props.onAddProvider()
          return
        }
        const provider = props.providers[s.cursor]
        if (provider) {
          setStage({ kind: 'models', providerId: provider.id })
          setCursor(0)
        }
      } else if (key.escape) {
        props.onCancel()
      }
      return
    }
    // models stage
    if (s.load.kind === 'loading') {
      if (key.escape) {
        setStage({ kind: 'providers' })
        setCursor(0)
      }
      return
    }
    const total = s.load.models.length
    if (total === 0) {
      if (key.escape) {
        setStage({ kind: 'providers' })
        setCursor(0)
      }
      return
    }
    if (key.upArrow) setCursor(c => Math.max(0, c - 1))
    else if (key.downArrow) setCursor(c => Math.min(total - 1, c + 1))
    else if (input === ' ') {
      const model = s.load.models[s.cursor]
      if (!model || !s.currentProvider) return
      const isIn = s.shortlist.includes(model)
      const next = isIn ? s.shortlist.filter(m => m !== model) : [...s.shortlist, model]
      setShortlist(next)
      void persistShortlist(s.currentProvider.id, next)
    } else if (key.return) {
      const model = s.load.models[s.cursor]
      if (!model || !s.currentProvider) return
      let next = s.shortlist
      if (!next.includes(model)) {
        next = [...next, model]
        setShortlist(next)
      }
      setSelectedModel(model)
      void persistActive(s.currentProvider.id, model, next).then(() => {
        props.onSelect(s.currentProvider!.id, model)
      })
    } else if (key.escape) {
      setStage({ kind: 'providers' })
      setCursor(0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props, persistShortlist, persistActive])

  useInput(inputHandler)

  if (stage.kind === 'providers') {
    return (
      <Box flexDirection="column">
        <Text color={colors.fg}>Select provider:</Text>
        {props.providers.map((p, i) => {
          const selected = i === cursor
          return (
            <Text key={p.id} color={selected ? colors.primary : colors.fg} bold={selected}>
              {selected ? '›' : ' '} {p.name}  <Text color={colors.fgMuted}>{p.baseUrl}</Text>
            </Text>
          )
        })}
        {(() => {
          const i = props.providers.length
          const selected = i === cursor
          return (
            <Text color={selected ? colors.primary : colors.fg} bold={selected}>
              {selected ? '›' : ' '} [+] Add provider…
            </Text>
          )
        })()}
        <Box marginTop={1}>
          <Text color={colors.fgMuted}>↑↓ navigate · ⏎ open · Esc cancel</Text>
        </Box>
      </Box>
    )
  }

  // models stage
  const provider = currentProvider!
  const sessionActive =
    props.activeProviderId === provider.id ? props.activeModel : undefined
  const activeMark = selectedModel ?? sessionActive

  return (
    <Box flexDirection="column">
      <Text color={colors.fg}>{provider.name} <Text color={colors.fgMuted}>· {provider.baseUrl}</Text></Text>
      {load.kind === 'loading' && (
        <Text color={colors.fgMuted}>Loading models from /v1/models…</Text>
      )}
      {load.kind === 'loaded' && load.error && (
        <Text color={colors.error}>fetch failed: {load.error} (fallback to local shortlist)</Text>
      )}
      {load.kind === 'loaded' && load.models.length === 0 && (
        <Text color={colors.fgMuted}>No models available. Add one via /settings.</Text>
      )}
      {load.kind === 'loaded' && load.models.length > 0 && (() => {
        const total = load.models.length
        const sel = Math.max(0, Math.min(cursor, total - 1))
        let start: number, end: number
        if (total <= MODEL_WINDOW) {
          start = 0
          end = total
        } else {
          const half = Math.floor(MODEL_WINDOW / 2)
          start = Math.max(0, sel - half)
          end = Math.min(total, start + MODEL_WINDOW)
          if (end - start < MODEL_WINDOW) start = Math.max(0, end - MODEL_WINDOW)
        }
        const showUp = start > 0
        const showDown = end < total
        // 8 cols of chrome: cursor "› " + "[x] " + safety. Use truncate-middle
        // for very long ids so users still see the model family + tail.
        const rowWidth = Math.max(20, columns - 8)
        return (
          <>
            {showUp && <Text color={colors.fgMuted}>  ↑ more above</Text>}
            {load.models.slice(start, end).map((m, idx) => {
              const i = start + idx
              const inShortlist = shortlist.includes(m)
              const isActive = m === activeMark
              const mark = isActive && inShortlist ? '●' : inShortlist ? 'x' : ' '
              const selected = i === sel
              return (
                <Box key={m} width={rowWidth}>
                  <Text color={selected ? colors.primary : colors.fg} bold={selected} wrap="truncate-middle">
                    {selected ? '›' : ' '} [{mark}] {m}
                  </Text>
                </Box>
              )
            })}
            {showDown && <Text color={colors.fgMuted}>  ↓ more below</Text>}
          </>
        )
      })()}
      <Box marginTop={1}>
        <Text color={colors.fgMuted}>
          space toggle · ⏎ activate · Esc back
        </Text>
      </Box>
    </Box>
  )
}
