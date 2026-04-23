// src/tui/dialogs/ModelPicker.tsx
import React, { useState, useRef, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'
// flushSyncFromReconciler forces state updates and the commit phase to run
// synchronously, which is required so that tests using ink-testing-library's
// stdin.write can observe DOM changes in the same tick.
// @ts-ignore — ink's reconciler is an internal module used here to force
// synchronous re-renders (via flushSyncFromReconciler) so that tests using
// ink-testing-library can observe state changes after stdin.write() calls.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import reconciler from '../../../node_modules/ink/build/reconciler.js'
import type { ProviderConfig } from '../../core/config/schema'
import { defaultPalette as P } from '../theme'

type View = { kind: 'root' } | { kind: 'models'; providerId: string }

type MenuItem = { label: string; action: () => void | Promise<void> }

// Wrap a setState call so the re-render is flushed synchronously.
// This lets tests observe updated frames immediately after stdin.write().
function syncSet(fn: () => void): void {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  ;(reconciler as { flushSyncFromReconciler: (fn: () => void) => void }).flushSyncFromReconciler(fn)
}

export function ModelPicker(props: {
  providers: ProviderConfig[]
  onSelect: (providerId: string, model: string) => void
  onAddProvider: () => void
  onRefresh: (providerId: string) => Promise<string[]>
  onCancel: () => void
}): React.JSX.Element {
  // All hooks are hoisted unconditionally to the top of the component to
  // satisfy React Rules of Hooks (no conditional hook calls).
  const [view, setView] = useState<View>({ kind: 'root' })
  const [cursor, setCursor] = useState(0)

  // models state is always present; populated when drilling into a provider.
  const currentProvider =
    view.kind === 'models'
      ? (props.providers.find(p => p.id === view.providerId) ?? null)
      : null
  const [models, setModels] = useState<string[]>(currentProvider?.models ?? [])

  // Build the item list for the current view.
  const items: MenuItem[] =
    view.kind === 'root'
      ? [
          ...props.providers.map(p => ({
            label: `${p.name}    ${p.baseUrl}`,
            action: () => {
              syncSet(() => {
                setModels(p.models ?? [])
                setView({ kind: 'models', providerId: p.id })
                setCursor(0)
              })
            },
          })),
          { label: '[+] Add provider…', action: props.onAddProvider },
        ]
      : currentProvider !== null
        ? [
            ...models.map(m => ({
              label: m,
              action: () => props.onSelect(currentProvider.id, m),
            })),
            {
              label: '[↻] Refresh from /v1/models',
              action: async () => {
                const fresh = await props.onRefresh(currentProvider.id)
                syncSet(() => { setModels(fresh); setCursor(0) })
              },
            },
            {
              label: '[← Back]',
              action: () => {
                syncSet(() => { setView({ kind: 'root' }); setCursor(0) })
              },
            },
          ]
        : []

  // Use a ref so the stable useInput callback always reads the latest state
  // without creating a new function reference on every render (which would
  // cause ink's useEffect to re-subscribe on each render — but async, meaning
  // rapid stdin writes would hit a stale listener).
  const stateRef = useRef({ items, cursor, view })
  stateRef.current = { items, cursor, view }

  // Single, stable useInput call — always at the top level (Rules of Hooks).
  // Logic is gated by view.kind at runtime via the ref.
  const inputHandler = useCallback((_input: string, key: import('ink').Key) => {
    const { items: currentItems, cursor: currentCursor, view: currentView } = stateRef.current
    if (key.upArrow) {
      setCursor(c => Math.max(0, c - 1))
    } else if (key.downArrow) {
      setCursor(c => Math.min(currentItems.length - 1, c + 1))
    } else if (key.return) {
      const item = currentItems[currentCursor]
      if (item !== undefined) {
        void item.action()
      }
    } else if (key.escape) {
      if (currentView.kind === 'models') {
        syncSet(() => { setView({ kind: 'root' }); setCursor(0) })
      } else {
        props.onCancel()
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally empty: all mutable state is accessed through stateRef

  useInput(inputHandler)

  if (view.kind === 'root') {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={P.primary} paddingX={1}>
        <Text color={P.primary} bold>Select provider</Text>
        {items.map((it, i) => (
          <Text key={i} color={i === cursor ? P.primary : P.fg}>
            {i === cursor ? '›' : ' '} {it.label}
          </Text>
        ))}
      </Box>
    )
  }

  // models view
  const provider = currentProvider ?? props.providers[0]!
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={P.primary} paddingX={1}>
      <Text color={P.primary} bold>{provider.name}</Text>
      {items.map((it, i) => (
        <Text key={i} color={i === cursor ? P.primary : P.fg}>
          {i === cursor ? '›' : ' '} {it.label}
        </Text>
      ))}
    </Box>
  )
}
