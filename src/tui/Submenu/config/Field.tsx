// src/tui/Submenu/config/Field.tsx
//
// Phase 12 §4.7 — Field primitive used by every category form. It owns
// label + value and switches between view / edit / error modes.
//
// Field types in scope for Phase 12 (multi-select / list editing is
// out of scope per spec §8):
//   - text     — free-form string input
//   - password — masked while displayed (••••), plaintext while editing
//   - select   — single choice from a fixed set; ←/→ cycles, Enter commits
//   - toggle   — bool; Space/Enter flips
//
// Modes:
//   - view  : Enter/⏎ enters edit mode (when focused). Tab/↓ moves focus
//             to the next field; the parent ConfigSubmenu manages cursor.
//   - edit  : printable chars append, Backspace deletes, Enter commits
//             pending value to onChange and returns to view; Esc reverts.
//   - error : 1.5 s flash with `error`-coloured frame after a failed save.
//             Reverts back to view automatically.

import React, { useEffect, useRef, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { useColors } from '../../../core/theme/context'

export type FieldType = 'text' | 'password' | 'select' | 'toggle'

export type FieldProps = {
  /** Display label rendered to the left of the value. */
  label: string
  /** Field type — drives both renderer and key handler. */
  type: FieldType
  /** Current committed value (string for text/password/select, bool for toggle). */
  value: string | boolean
  /** Choice list for `select`. Ignored for other types. */
  choices?: string[]
  /** Whether keyboard focus is on this field (parent owns cursor). */
  focused?: boolean
  /** Whether the field is disabled (read-only display). */
  disabled?: boolean
  /** Whether to render the surrounding "error flash" border. */
  errored?: boolean
  /**
   * Called when the user commits a new value (Enter in edit mode, Space in
   * toggle mode, ←/→ in select mode). Parent stores the pending value;
   * `s` save is form-level.
   */
  onChange?: (next: string | boolean) => void
}

const MASK_CHAR = '•'

function maskValue(v: string): string {
  if (v.length === 0) return ''
  return MASK_CHAR.repeat(Math.min(v.length, 24))
}

export function Field(props: FieldProps): React.JSX.Element {
  const colors = useColors()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<string>(typeof props.value === 'string' ? props.value : '')
  // Keep the draft in sync with parent-driven value changes (e.g. when the
  // ConfigSubmenu re-mounts with fresh config).
  const lastValueRef = useRef<string | boolean>(props.value)
  useEffect(() => {
    if (lastValueRef.current !== props.value) {
      lastValueRef.current = props.value
      if (typeof props.value === 'string' && !editing) setDraft(props.value)
    }
  }, [props.value, editing])

  const enabled = props.focused === true && !props.disabled

  useInput((inputKey, key) => {
    if (!enabled) return
    // toggle: Space/Enter flips immediately
    if (props.type === 'toggle') {
      if (key.return || inputKey === ' ') {
        props.onChange?.(!(props.value === true))
      }
      return
    }
    // select: ←/→ cycles through choices
    if (props.type === 'select') {
      const choices = props.choices ?? []
      if (choices.length === 0) return
      const cur = typeof props.value === 'string' ? props.value : ''
      const idx = Math.max(0, choices.indexOf(cur))
      if (key.leftArrow) {
        const next = choices[(idx - 1 + choices.length) % choices.length]!
        props.onChange?.(next)
      } else if (key.rightArrow || inputKey === ' ' || key.return) {
        const next = choices[(idx + 1) % choices.length]!
        props.onChange?.(next)
      }
      return
    }
    // text/password: Enter toggles edit mode
    if (!editing) {
      if (key.return) {
        setDraft(typeof props.value === 'string' ? props.value : '')
        setEditing(true)
      }
      return
    }
    // editing
    if (key.return) {
      props.onChange?.(draft)
      setEditing(false)
      return
    }
    if (key.escape) {
      // Revert; parent's Esc handler runs only after edit-mode is exited
      setEditing(false)
      return
    }
    if (key.backspace || key.delete) {
      setDraft(d => d.slice(0, -1))
      return
    }
    if (key.ctrl || key.meta) return
    // append printable characters
    if (inputKey && inputKey.length > 0 && !key.tab && !key.upArrow && !key.downArrow) {
      setDraft(d => d + inputKey)
    }
  }, { isActive: enabled })

  // Visual rendering --------------------------------------------------------

  const labelColor = props.focused ? colors.primary : colors.fgMuted
  const valueColor = props.disabled ? colors.fgFaint : colors.fg
  const borderColor = props.errored
    ? colors.error
    : props.focused
      ? colors.primary
      : colors.fgMuted

  let displayValue: string
  if (props.type === 'toggle') {
    displayValue = props.value === true ? '☑ on' : '☐ off'
  } else if (props.type === 'select') {
    const cur = typeof props.value === 'string' ? props.value : ''
    displayValue = cur || '—'
    if (enabled) displayValue += '  ◂▸'
  } else if (props.type === 'password') {
    if (editing) displayValue = draft + '▎'
    else displayValue = maskValue(typeof props.value === 'string' ? props.value : '')
  } else {
    if (editing) displayValue = draft + '▎'
    else displayValue = (typeof props.value === 'string' ? props.value : '') || '—'
  }

  return (
    <Box
      flexDirection="row"
      borderStyle="single"
      borderColor={borderColor}
      paddingX={1}
    >
      <Box width={14}>
        <Text color={labelColor} bold={props.focused}>
          {props.focused ? '▸ ' : '  '}{props.label}
        </Text>
      </Box>
      <Box flexGrow={1}>
        <Text color={editing ? colors.primary : valueColor}>{displayValue}</Text>
      </Box>
      {editing && (
        <Box>
          <Text color={colors.fgMuted}>edit</Text>
        </Box>
      )}
    </Box>
  )
}
