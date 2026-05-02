// src/tui/Submenu/harness/HarnessSubmenu.tsx
//
// Phase 14d — Harness control submenu.
//
// Shown when the user runs `/harness` with no arguments. Provides four
// top-level entries:
//   - Mode        — push to a 3-item picker (deep / fast / off).
//   - Stage       — informational, disabled (cannot activate).
//   - Transition… — push to a stage list; activating attempts a manual
//                   transition. Errors flash for 1.5s then return to menu.
//   - Retriage    — invokes the parent's retriage handler then closes.
//
// The component owns its subpage stack internally; the parent only sees
// terminal effects via the four callbacks. SubmenuFrame chrome is rendered
// here so the call site stays a single `<HarnessSubmenu .../>`.
//
// Esc / ← from the top-level menu calls onClose; from a subpage it pops
// back to the menu.

import React, { useEffect, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { SubmenuFrame } from '../SubmenuFrame'
import { SubmenuList, type SubmenuListItem } from '../SubmenuList'
import { useColors } from '../../../core/theme/context'
import type { HarnessMode, HarnessStage } from '../../../core/harness/types'

export type HarnessSubmenuProps = {
  /** Snapshot of current harness state. */
  snapshot: { mode: HarnessMode; stage: HarnessStage; sessionId: string }
  /** Available stage transitions to surface. */
  availableStages: readonly HarnessStage[]
  /** Switch mode (deep | fast | off). */
  onSetMode: (mode: HarnessMode) => void
  /** Manually transition stage. Rejection flashes an error in the submenu. */
  onTransition: (to: HarnessStage) => Promise<void>
  /** Open retriage flow. Parent handles the prompt-for-hint UX. */
  onRetriage: () => void
  /** Close the submenu. */
  onClose: () => void
}

type View =
  | { kind: 'menu' }
  | { kind: 'mode-list' }
  | { kind: 'transition-list' }
  | { kind: 'error'; text: string }

const ALL_MODES: readonly HarnessMode[] = ['deep', 'fast', 'off'] as const

export function HarnessSubmenu(props: HarnessSubmenuProps): React.JSX.Element {
  const colors = useColors()
  const [view, setView] = useState<View>({ kind: 'menu' })

  // Auto-pop from error view back to menu after 1.5s.
  useEffect(() => {
    if (view.kind !== 'error') return
    const t = setTimeout(() => setView({ kind: 'menu' }), 1500)
    return () => clearTimeout(t)
  }, [view])

  // Pop-back handler for views that don't render a SubmenuList (i.e. the
  // empty-transition state and the error flash). The list views own their
  // own onCancel via SubmenuList, so we only need this fallback when the
  // list isn't on screen — gate via `isActive` so we don't double-handle.
  const isFallbackView =
    view.kind === 'error' ||
    (view.kind === 'transition-list' &&
      props.availableStages.filter(s => s !== props.snapshot.stage).length === 0)
  useInput((_input, key) => {
    if (key.escape || key.leftArrow) {
      if (view.kind === 'error') {
        setView({ kind: 'menu' })
      } else if (view.kind === 'transition-list') {
        setView({ kind: 'menu' })
      }
    }
  }, { isActive: isFallbackView })

  // Top-level menu items.
  if (view.kind === 'menu') {
    const items: SubmenuListItem[] = [
      {
        id: 'mode',
        label: 'Mode',
        description: 'switch harness mode',
        value: props.snapshot.mode,
      },
      {
        id: 'stage',
        label: 'Stage',
        description: 'current stage',
        value: `${props.snapshot.stage} (read-only)`,
        disabled: true,
      },
      {
        // The Stage row above already advertises the live stage. The
        // Transition row is an action — describe what it *does*, not the
        // current stage value (Bug #11: avoid showing the same stage twice
        // and confusing which row is authoritative).
        id: 'transition',
        label: 'Transition…',
        description: 'manually move to another stage',
      },
      {
        id: 'retriage',
        label: 'Retriage',
        description: '(re-classify with hint)',
      },
    ]
    return (
      <SubmenuFrame mode="full" title="Harness" focused footer="↑↓ select · ⏎ open · Esc close">
        <SubmenuList
          key="menu"
          items={items}
          omitFooter
          onSelect={(item) => {
            if (item.id === 'mode') setView({ kind: 'mode-list' })
            else if (item.id === 'transition') setView({ kind: 'transition-list' })
            else if (item.id === 'retriage') {
              props.onRetriage()
              props.onClose()
            }
          }}
          onCancel={props.onClose}
        />
      </SubmenuFrame>
    )
  }

  if (view.kind === 'mode-list') {
    const items: SubmenuListItem[] = ALL_MODES.map(m => ({
      id: m,
      label: m,
      value: m === props.snapshot.mode ? '(active)' : undefined,
    }))
    return (
      <SubmenuFrame mode="full" title="Harness · Mode" focused footer="↑↓ select · ⏎ apply · Esc back">
        <SubmenuList
          key="mode-list"
          items={items}
          omitFooter
          onSelect={(item) => {
            props.onSetMode(item.id as HarnessMode)
            setView({ kind: 'menu' })
          }}
          onCancel={() => setView({ kind: 'menu' })}
        />
      </SubmenuFrame>
    )
  }

  if (view.kind === 'transition-list') {
    const items: SubmenuListItem[] = props.availableStages
      .filter(s => s !== props.snapshot.stage)
      .map(s => ({ id: s, label: s }))
    // Bug #12: when no other stages are available (e.g. the current stage
    // is the only one allowed by the active profile×difficulty cell),
    // render an explicit empty state instead of an empty SubmenuList — an
    // empty list with no rows is indistinguishable from a render failure.
    if (items.length === 0) {
      return (
        <SubmenuFrame mode="full" title="Harness · Transition" focused footer="Esc back">
          <Box paddingX={1} flexDirection="column">
            <Text color={colors.fgMuted}>
              No transitions available from "{props.snapshot.stage}".
            </Text>
            <Text color={colors.fgMuted} dimColor>
              Press Esc / ← to return to the menu.
            </Text>
          </Box>
        </SubmenuFrame>
      )
    }
    return (
      <SubmenuFrame mode="full" title="Harness · Transition" focused footer="↑↓ select · ⏎ apply · Esc back">
        <SubmenuList
          key="transition-list"
          items={items}
          omitFooter
          onSelect={async (item) => {
            try {
              await props.onTransition(item.id as HarnessStage)
              setView({ kind: 'menu' })
            } catch (e) {
              const msg = (e as Error)?.message ?? 'transition failed'
              setView({ kind: 'error', text: msg })
            }
          }}
          onCancel={() => setView({ kind: 'menu' })}
        />
      </SubmenuFrame>
    )
  }

  // view.kind === 'error'
  return (
    <SubmenuFrame mode="full" title="Harness" focused footer="returning…">
      <Box paddingX={1}>
        <Text color={colors.error ?? colors.fgMuted}>{view.text}</Text>
      </Box>
    </SubmenuFrame>
  )
}
