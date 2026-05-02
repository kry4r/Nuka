// src/tui/Onboarding/Wizard.tsx
//
// Stateful TUI shell around the pure `wizard` reducer. Drives async side
// effects (the API-key probe) and surfaces final ConfigPatch / cancellation
// to the caller.
//
// Implementation note: a single `useInput` lives at the Wizard root and
// dispatches based on the current state. Step components are presentation-
// only. This avoids cross-step raw-mode churn that breaks `ink-testing-
// library` when multiple `useInput` callbacks mount/unmount during a test.

import React, { useReducer, useEffect, useRef, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import stringWidth from 'string-width'
import {
  reducer,
  initialState,
  type WizardState,
  type ConfigPatch,
} from '../../core/onboarding/wizard'
import { probeProvider, type FetchLike } from '../../core/onboarding/providerProbe'
import { defaultPalette as P } from '../theme'
import { useTerminalSize } from '../hooks/useTerminalSize'
import { PickProvider } from './Steps/PickProvider'
import { EnterKey } from './Steps/EnterKey'
import { PickModel } from './Steps/PickModel'
import { Verifying } from './Steps/Verifying'
import { Done } from './Steps/Done'

/** Width-aware right-truncation: keeps the head, drops the tail with "…". */
function truncateRightToFit(s: string, maxWidth: number): string {
  if (maxWidth <= 0) return ''
  if (stringWidth(s) <= maxWidth) return s
  const budget = maxWidth - 1
  const chars = Array.from(s)
  let width = 0
  let i = 0
  while (i < chars.length) {
    const ch = chars[i]!
    const w = stringWidth(ch)
    if (width + w > budget) break
    width += w
    i++
  }
  return chars.slice(0, i).join('') + '…'
}

type LocalUI = {
  /** cursor for pickProvider / pickModel */
  cursor: number
  /** typed buffer for apiKey */
  keyBuf: string
  /** typed buffers + active field index for customDetails */
  custom: { name: string; baseUrl: string; model: string; format: 'anthropic' | 'openai'; field: 0 | 1 | 2 | 3 }
}

export function Wizard(props: {
  onDone: (config: ConfigPatch) => void
  onCancel: () => void
  /** test seam — replaces `globalThis.fetch` for the probe */
  fetchFn?: FetchLike
  /** test seam — replaces probeProvider entirely */
  probeFn?: typeof probeProvider
  initial?: WizardState
}): React.JSX.Element {
  const [state, dispatch] = useReducer(reducer, props.initial ?? initialState())
  const [ui, setUi] = useState<LocalUI>({
    cursor: 0,
    keyBuf: '',
    custom: { name: '', baseUrl: '', model: '', format: 'openai', field: 0 },
  })

  const stateRef = useRef(state)
  stateRef.current = state
  const uiRef = useRef(ui)
  uiRef.current = ui

  // Reset local UI whenever the wizard state kind changes (so cursors
  // don't bleed between screens).
  const lastKindRef = useRef(state.kind)
  useEffect(() => {
    if (lastKindRef.current !== state.kind) {
      lastKindRef.current = state.kind
      const seedKey =
        state.kind === 'apiKey'
          ? state.key
          : state.kind === 'error' && state.retryFrom === 'apiKey'
            ? state.key ?? ''
            : ''
      const seedCursor =
        state.kind === 'pickModel' && state.selected
          ? Math.max(0, state.models.indexOf(state.selected))
          : 0
      setUi(prev => ({ ...prev, cursor: seedCursor, keyBuf: seedKey }))
    }
  }, [state])

  // Single root-level input handler. Routes per current state.kind.
  useInput((input, key) => {
    const s = stateRef.current
    const u = uiRef.current
    if (key.escape) {
      dispatch({ type: 'cancel' })
      return
    }
    switch (s.kind) {
      case 'welcome': {
        if (key.return) dispatch({ type: 'start' })
        return
      }
      case 'pickProvider': {
        const len = s.choices.length
        if (key.upArrow) setUi(prev => ({ ...prev, cursor: Math.max(0, prev.cursor - 1) }))
        else if (key.downArrow) setUi(prev => ({ ...prev, cursor: Math.min(len - 1, prev.cursor + 1) }))
        else if (key.return) {
          const t = s.choices[u.cursor]
          if (t) dispatch({ type: 'pickedProvider', template: t })
        } else if (key.leftArrow) dispatch({ type: 'back' })
        return
      }
      case 'customDetails': {
        // ↑/↓ or Tab cycle fields. Enter on the LAST field submits;
        // Enter on any other field moves to the next.
        const cycleField = (delta: number) =>
          setUi(prev => ({
            ...prev,
            custom: { ...prev.custom, field: (((prev.custom.field + delta) % 4 + 4) % 4) as 0 | 1 | 2 | 3 },
          }))
        if (key.upArrow) { cycleField(-1); return }
        if (key.downArrow || key.tab) { cycleField(1); return }
        if (key.return) {
          // Enter on a non-final field acts like ↓.
          if (u.custom.field < 3) { cycleField(1); return }
          const c = u.custom
          if (!c.baseUrl.trim() || !c.model.trim()) return
          dispatch({
            type: 'enteredCustom',
            details: {
              name: c.name.trim() || 'Custom',
              format: c.format,
              baseUrl: c.baseUrl.trim(),
              model: c.model.trim(),
            },
          })
          return
        }
        if (key.leftArrow) { dispatch({ type: 'back' }); return }
        if (key.backspace || key.delete) {
          setUi(prev => {
            const f = prev.custom.field
            const c = { ...prev.custom }
            if (f === 0) c.name = c.name.slice(0, -1)
            else if (f === 1) c.baseUrl = c.baseUrl.slice(0, -1)
            else if (f === 2) c.model = c.model.slice(0, -1)
            return { ...prev, custom: c }
          })
          return
        }
        if (u.custom.field === 3) {
          // Format toggle on the last field — type 'a' for anthropic, 'o' for openai.
          if (input === 'a' || input === 'A') setUi(prev => ({ ...prev, custom: { ...prev.custom, format: 'anthropic' } }))
          else if (input === 'o' || input === 'O') setUi(prev => ({ ...prev, custom: { ...prev.custom, format: 'openai' } }))
          return
        }
        if (input && !key.ctrl && !key.meta) {
          setUi(prev => {
            const f = prev.custom.field
            const c = { ...prev.custom }
            if (f === 0) c.name = c.name + input
            else if (f === 1) c.baseUrl = c.baseUrl + input
            else if (f === 2) c.model = c.model + input
            return { ...prev, custom: c }
          })
        }
        return
      }
      case 'apiKey': {
        if (key.return) {
          if (u.keyBuf.trim().length > 0) dispatch({ type: 'enteredKey', key: u.keyBuf })
        } else if (key.backspace || key.delete) {
          setUi(prev => ({ ...prev, keyBuf: prev.keyBuf.slice(0, -1) }))
        } else if (key.leftArrow) {
          dispatch({ type: 'back' })
        } else if (input && !key.ctrl && !key.meta) {
          setUi(prev => ({ ...prev, keyBuf: prev.keyBuf + input }))
        }
        return
      }
      case 'pickModel': {
        const len = s.models.length
        if (key.upArrow) setUi(prev => ({ ...prev, cursor: Math.max(0, prev.cursor - 1) }))
        else if (key.downArrow) setUi(prev => ({ ...prev, cursor: Math.min(len - 1, prev.cursor + 1) }))
        else if (key.return) {
          const m = s.models[u.cursor]
          if (m) dispatch({ type: 'pickedModel', model: m })
        } else if (key.leftArrow) dispatch({ type: 'back' })
        return
      }
      case 'verifying': {
        // ignore input — async probe drives the state
        return
      }
      case 'error': {
        if (key.return || key.leftArrow) dispatch({ type: 'back' })
        return
      }
      case 'done':
      case 'cancelled':
        return
    }
  })

  // Async probe.
  const probedKey = useRef<string>('')
  useEffect(() => {
    if (state.kind !== 'verifying') {
      probedKey.current = ''
      return
    }
    const tag = `${state.provider.id}::${state.key}::${state.model}`
    if (probedKey.current === tag) return
    probedKey.current = tag
    let cancelled = false
    const run = async () => {
      const probe = props.probeFn ?? probeProvider
      const r = await probe(state.provider, state.key, props.fetchFn)
      if (cancelled) return
      if (r.ok) dispatch({ type: 'probeOk', models: r.models })
      else dispatch({ type: 'probeErr', reason: r.reason })
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [state, props.fetchFn, props.probeFn])

  // Terminal-state callbacks (fire-once).
  const fired = useRef(false)
  useEffect(() => {
    if (fired.current) return
    if (state.kind === 'done') {
      fired.current = true
      props.onDone(state.config)
    } else if (state.kind === 'cancelled') {
      fired.current = true
      props.onCancel()
    }
  }, [state, props])

  // Presentation only — no useInput in any child.
  if (state.kind === 'welcome') return <Welcome />
  if (state.kind === 'pickProvider') {
    return <PickProvider choices={state.choices} cursor={ui.cursor} />
  }
  if (state.kind === 'customDetails') {
    return <CustomDetailsScreen ui={ui.custom} />
  }
  if (state.kind === 'apiKey') {
    return <EnterKey provider={state.provider} value={ui.keyBuf} />
  }
  if (state.kind === 'pickModel') {
    return <PickModel provider={state.provider} models={state.models} cursor={ui.cursor} />
  }
  if (state.kind === 'verifying') {
    return <Verifying provider={state.provider} model={state.model} />
  }
  if (state.kind === 'error') {
    return <ErrorScreen message={state.message} />
  }
  if (state.kind === 'done') {
    return <Done config={state.config} />
  }
  return (
    <Box>
      <Text color={P.fgMuted}>cancelled</Text>
    </Box>
  )
}

function Welcome(): React.JSX.Element {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={P.primary} paddingX={1}>
      <Text color={P.primary} bold>Welcome to Nuka</Text>
      <Text color={P.fg}>Let's get a provider configured so you can start chatting.</Text>
      <Text color={P.fgMuted}>Press Enter to begin · Esc to cancel</Text>
    </Box>
  )
}

function CustomDetailsScreen(props: {
  ui: { name: string; baseUrl: string; model: string; format: 'anthropic' | 'openai'; field: 0 | 1 | 2 | 3 }
}): React.JSX.Element {
  const { ui: u } = props
  const { columns } = useTerminalSize()
  // 30 cols of chrome: label width(10) + "│ "(2) + cursor(1) + hint padding +
  // border(2) + paddingX(2) + safety. The hint is dropped when narrow.
  const valueWidth = Math.max(8, columns - 30)
  const Field = (i: 0 | 1 | 2 | 3, label: string, val: string, hint?: string) => (
    <Box>
      <Box width={10}>
        <Text color={u.field === i ? P.primary : P.fgMuted} bold={u.field === i}>{label}</Text>
      </Box>
      <Text color={P.fgMuted}>│ </Text>
      <Text color={P.fg}>{truncateRightToFit(val, valueWidth)}</Text>
      {u.field === i && <Text color={P.fg} inverse> </Text>}
      {hint && columns >= 80 && <Text color={P.fgMuted}>  {hint}</Text>}
    </Box>
  )
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={P.primary} paddingX={1}>
      <Text color={P.primary} bold>Custom provider</Text>
      <Text color={P.fgMuted}>↑/↓ switches fields · Enter advances/confirms · Esc to cancel</Text>
      <Box height={1} />
      {Field(0, 'name',    u.name || '(Custom)')}
      {Field(1, 'baseUrl', u.baseUrl, 'e.g. https://api.openai.com/v1')}
      {Field(2, 'model',   u.model,   'e.g. gpt-4o or claude-sonnet-4-6')}
      {Field(3, 'format',  u.format,  'press a/o for anthropic/openai')}
    </Box>
  )
}

function ErrorScreen(props: { message: string }): React.JSX.Element {
  const { columns } = useTerminalSize()
  // Cap at first newline + 200 chars so a server-side stack trace doesn't
  // blow out the frame; render multi-line in a paddingLeft={4} sub-box.
  const capped = props.message.length > 200
    ? props.message.slice(0, 200) + '…'
    : props.message
  const lines = capped.split('\n')
  const lineWidth = Math.max(20, columns - 8)
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={P.error} paddingX={1}>
      <Text color={P.error} bold>Verification failed</Text>
      <Box flexDirection="column" paddingLeft={4}>
        {lines.map((line, i) => (
          <Box key={i} width={lineWidth}>
            <Text color={P.fg} wrap="truncate-end">{line}</Text>
          </Box>
        ))}
      </Box>
      <Text color={P.fgMuted}>Enter retry · Esc cancel</Text>
    </Box>
  )
}

export type { ConfigPatch }
