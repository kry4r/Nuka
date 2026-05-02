// src/tui/PromptInput/PromptInput.tsx
import React, { useState, useEffect, useRef, useMemo } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import { defaultPalette as P } from '../theme'
import { useInputHistory } from './useInputHistory'
import { MentionPanel } from './MentionPanel'
import { fuzzyFileSearch } from './fuzzyFileSearch'
import { makeState, step, type State as VimState, type Key as VimKey } from '../../core/vim/controller'
import { bufferToText } from '../../core/vim/mode'
import type { SlashRegistry } from '../../slash/registry'

export type PromptInputProps = {
  value: string
  onChange: (v: string) => void
  onSubmit: (v: string) => void
  disabled: boolean
  /** Whether the Prompt frame currently owns keyboard focus.
   *  When omitted, falls back to `!disabled` for backwards compatibility. */
  focused?: boolean
  placeholder?: string
  cwd?: string
  onAttachFile?: (path: string) => void
  /** When true, route keystrokes through the vim controller. Defaults to false. */
  vim?: boolean
  /** Slash registry — when provided, typing `/` shows command suggestions. */
  slash?: SlashRegistry
  /** Notified whenever the slash submenu opens/closes; lets parent hide chrome. */
  onSlashActiveChange?: (active: boolean) => void
  /** Notified whenever the slash cursor index changes; lets parent render SlashCard. */
  onSlashCursorChange?: (cursor: number) => void
}

export function PromptInput(props: PromptInputProps): React.JSX.Element {
  const history = useInputHistory()

  const [mentionActive, setMentionActive] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionMatches, setMentionMatches] = useState<string[]>([])
  const [mentionCursor, setMentionCursor] = useState(0)
  const [slashCursor, setSlashCursor] = useState(0)

  // Slash mode: active as long as value starts with `/` and registry is given.
  // The list ↔ arg-hint distinction lives inside SlashCard, not here.
  const slashActive = useMemo(() => {
    return !!(props.slash && props.value.startsWith('/'))
  }, [props.slash, props.value])

  // Slash list candidates (used for Tab completion and cursor bounds in list mode).
  const slashCandidates = useMemo(() => {
    if (!props.slash || !props.value.startsWith('/')) return []
    if (props.value.includes(' ')) return [] // arg-hint mode — no list candidates
    const prefix = props.value.slice(1)
    return props.slash.suggest(prefix).map(c => ({ name: c.name, description: c.description }))
  }, [props.slash, props.value])

  useEffect(() => {
    if (slashCursor > Math.max(0, slashCandidates.length - 1)) setSlashCursor(0)
  }, [slashCandidates.length, slashCursor])
  useEffect(() => {
    props.onSlashActiveChange?.(slashActive)
  }, [slashActive, props.onSlashActiveChange])
  useEffect(() => {
    props.onSlashCursorChange?.(slashCursor)
  }, [slashCursor, props.onSlashCursorChange])

  // Vim controller state (only used when props.vim is true).
  const vimRef = useRef<VimState>(makeState(props.value, 'insert'))
  const [vimMode, setVimMode] = useState<'insert' | 'normal' | 'visual'>('insert')

  // Re-sync vim buffer from controlled value when external value diverges.
  useEffect(() => {
    if (!props.vim) return
    if (bufferToText(vimRef.current.buffer) !== props.value) {
      vimRef.current = makeState(props.value, vimRef.current.buffer.mode)
    }
  }, [props.vim, props.value])

  function applyVimKey(k: VimKey): void {
    const next = step(vimRef.current, k)
    vimRef.current = next
    setVimMode(next.buffer.mode)
    const text = bufferToText(next.buffer)
    if (text !== props.value) props.onChange(text)
  }

  useEffect(() => {
    if (!mentionActive) return
    const cwd = props.cwd ?? process.cwd()
    fuzzyFileSearch({ query: mentionQuery, cwd }).then(results => {
      setMentionMatches(results)
      setMentionCursor(0)
    })
  }, [mentionActive, mentionQuery, props.cwd])

  useInput((input, key) => {
    if (props.disabled) return

    // Vim mode: in normal/visual we route through the controller. In insert
    // we let the existing behavior fall through (typing/backspace/enter all
    // work as before) but we also push the keystroke into the controller
    // so the vim buffer stays in sync for the next mode toggle.
    if (props.vim && !mentionActive) {
      const isInsert = vimRef.current.buffer.mode === 'insert'
      // Esc: enter normal mode (no-op if already there).
      if (key.escape) {
        applyVimKey({ kind: 'esc' })
        return
      }
      if (!isInsert) {
        // Normal/Visual mode — eat all keys; submit only on Enter from normal.
        if (key.return) {
          if (props.value.trim()) {
            history.push(props.value)
            props.onSubmit(props.value)
          }
          return
        }
        if (key.backspace || key.delete) {
          applyVimKey({ kind: 'char', ch: 'h' })
          return
        }
        if (key.upArrow) { applyVimKey({ kind: 'char', ch: 'k' }); return }
        if (key.downArrow) { applyVimKey({ kind: 'char', ch: 'j' }); return }
        if (key.leftArrow) { applyVimKey({ kind: 'char', ch: 'h' }); return }
        if (key.rightArrow) { applyVimKey({ kind: 'char', ch: 'l' }); return }
        if (input && !key.ctrl && !key.meta) {
          for (const ch of input) applyVimKey({ kind: 'char', ch })
          return
        }
        return
      }
      // Insert mode in vim: let typing/backspace go through the controller;
      // Enter still submits via the legacy history+onSubmit logic below; up/down
      // arrows still walk history. We return early so the legacy character-append
      // path doesn't double-apply.
      if (key.return) {
        if (props.value.trim()) {
          history.push(props.value)
          props.onSubmit(props.value)
        }
        return
      }
      if (key.upArrow) {
        const prev = history.prev(props.value)
        if (prev !== null) props.onChange(prev)
        return
      }
      if (key.downArrow) {
        const next = history.next()
        if (next !== null) props.onChange(next)
        return
      }
      if (key.backspace || key.delete) {
        applyVimKey({ kind: 'backspace' })
        history.reset()
        return
      }
      if (input && !key.ctrl && !key.meta) {
        for (const ch of input) applyVimKey({ kind: 'char', ch })
        history.reset()
        return
      }
      return
    }

    if (mentionActive) {
      if (key.escape) {
        setMentionActive(false)
        setMentionQuery('')
        return
      }
      if (key.upArrow) {
        setMentionCursor(c => Math.max(0, c - 1))
        return
      }
      if (key.downArrow) {
        setMentionCursor(c => Math.min(mentionMatches.length - 1, c + 1))
        return
      }
      if (key.return) {
        const chosen = mentionMatches[mentionCursor]
        if (chosen) {
          // Replace trailing @<query> in value with @{path}
          const base = props.value.replace(new RegExp('@' + escapeRegex(mentionQuery) + '$'), '')
          props.onChange(base + '@' + chosen + ' ')
          props.onAttachFile?.(chosen)
        }
        setMentionActive(false)
        setMentionQuery('')
        return
      }
      if (key.backspace || key.delete) {
        if (mentionQuery.length === 0) {
          setMentionActive(false)
        } else {
          setMentionQuery(q => q.slice(0, -1))
          props.onChange(props.value.slice(0, -1))
        }
        return
      }
      if (!key.ctrl && !key.meta && input) {
        setMentionQuery(q => q + input)
        props.onChange(props.value + input)
        return
      }
      return
    }

    // Slash overlay: navigate / accept while active.
    if (slashActive) {
      const argHintMode = props.value.includes(' ')
      if (!argHintMode) {
        // List mode: arrow keys navigate, Tab accepts.
        if (key.upArrow) {
          setSlashCursor(c => Math.max(0, c - 1))
          return
        }
        if (key.downArrow) {
          setSlashCursor(c => Math.min(slashCandidates.length - 1, c + 1))
          return
        }
        if (key.tab) {
          const chosen = slashCandidates[slashCursor]
          if (chosen) props.onChange('/' + chosen.name + ' ')
          return
        }
      } else {
        // Arg-hint mode: Tab is no-op.
        if (key.tab) return
        if (key.upArrow || key.downArrow) return
      }
      if (key.escape) {
        // Clearing the slash drops the suggestion; let the App-level esc handler
        // run on the next keypress for primed-quit etc.
        props.onChange('')
        return
      }
      // Enter falls through to normal submit so the user can run the command
      // they've typed (or the highlighted one if value matches a candidate).
    }

    // Normal mode
    if (key.return) {
      if (props.value.trim()) {
        // If in slash list mode and a candidate is highlighted but the typed
        // text doesn't exactly match a command, expand to the highlighted one.
        let toSubmit = props.value
        const argHintMode = slashActive && props.value.includes(' ')
        if (slashActive && !argHintMode && slashCandidates.length > 0) {
          const exact = slashCandidates.find(c => '/' + c.name === props.value)
          if (!exact) {
            const chosen = slashCandidates[slashCursor]
            if (chosen) toSubmit = '/' + chosen.name
          }
        }
        history.push(toSubmit)
        props.onSubmit(toSubmit)
      }
      return
    }
    if (key.upArrow) {
      const prev = history.prev(props.value)
      if (prev !== null) props.onChange(prev)
      return
    }
    if (key.downArrow) {
      const next = history.next()
      if (next !== null) props.onChange(next)
      return
    }
    if (key.backspace || key.delete) {
      history.reset()
      props.onChange(props.value.slice(0, -1))
      return
    }
    if (!key.ctrl && !key.meta && input) {
      history.reset()
      // Detect @ trigger: input is '@' and value is empty or ends in whitespace
      if (input === '@' && (props.value === '' || /\s$/.test(props.value))) {
        setMentionActive(true)
        setMentionQuery('')
      }
      props.onChange(props.value + input)
    }
  }, { isActive: !props.disabled })

  const showCursor = !props.disabled && (!props.vim || vimMode === 'insert')
  const placeholder = props.placeholder ?? ''
  const isEmpty = props.value.length === 0

  // Bug B — terminal-column truncation.
  // The outer Box uses paddingX=1 + a single-char border on each side, plus
  // the "> " marker (2 chars) and the trailing inverse-space cursor (1 char).
  // When the value exceeds (columns - chrome) Ink wraps the <Text>, which
  // pushes content over the bottom border and looks like overlap. We truncate
  // the *display* (not props.value) keeping the tail visible so the user
  // still sees what they're typing. Kept conservative: only kicks in when the
  // tty is narrow enough to actually wrap.
  const { stdout } = useStdout()
  const columns = stdout?.columns ?? 80
  const CHROME = 8 // borders(2) + paddingX(2) + "> "(2) + cursor(1) + safety(1)
  const visibleBudget = Math.max(8, columns - CHROME)
  const valueText = props.value.length > visibleBudget
    ? '…' + props.value.slice(-(visibleBudget - 1))
    : props.value

  return (
    <Box flexDirection="column">
      {mentionActive && (
        <MentionPanel
          query={mentionQuery}
          matches={mentionMatches}
          cursor={mentionCursor}
          onSelect={chosen => {
            const base = props.value.replace(new RegExp('@' + escapeRegex(mentionQuery) + '$'), '')
            props.onChange(base + '@' + chosen + ' ')
            props.onAttachFile?.(chosen)
            setMentionActive(false)
            setMentionQuery('')
          }}
          onCancel={() => { setMentionActive(false); setMentionQuery('') }}
        />
      )}
      <Box
        borderStyle="round"
        borderColor={(props.focused ?? !props.disabled) ? P.primary : P.fgMuted}
        paddingX={1}
        flexShrink={0}
      >
        {props.vim && (
          <Text color={vimMode === 'insert' ? P.fgMuted : P.warn} bold>
            [{vimMode.toUpperCase().slice(0, 1)}]{' '}
          </Text>
        )}
        <Text color={P.primary}>{'> '}</Text>
        {isEmpty ? (
          <>
            {showCursor && <Text color={P.fg} inverse> </Text>}
            <Text color={P.fgMuted}>{placeholder}</Text>
          </>
        ) : (
          <>
            <Text color={P.fg}>{valueText}</Text>
            {showCursor && <Text color={P.fg} inverse> </Text>}
          </>
        )}
      </Box>
    </Box>
  )
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
