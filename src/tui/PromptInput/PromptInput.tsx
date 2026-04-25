// src/tui/PromptInput/PromptInput.tsx
import React, { useState, useEffect, useRef } from 'react'
import { Box, Text, useInput } from 'ink'
import { defaultPalette as P } from '../theme'
import { useInputHistory } from './useInputHistory'
import { MentionPanel } from './MentionPanel'
import { fuzzyFileSearch } from './fuzzyFileSearch'
import { makeState, step, type State as VimState, type Key as VimKey } from '../../core/vim/controller'
import { bufferToText } from '../../core/vim/mode'

export type PromptInputProps = {
  value: string
  onChange: (v: string) => void
  onSubmit: (v: string) => void
  disabled: boolean
  placeholder?: string
  cwd?: string
  onAttachFile?: (path: string) => void
  /** When true, route keystrokes through the vim controller. Defaults to false. */
  vim?: boolean
}

export function PromptInput(props: PromptInputProps): React.JSX.Element {
  const history = useInputHistory()

  const [mentionActive, setMentionActive] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionMatches, setMentionMatches] = useState<string[]>([])
  const [mentionCursor, setMentionCursor] = useState(0)

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

    // Normal mode
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
      <Box>
        <Text color={P.primary}>▎ </Text>
        {props.vim && (
          <Text color={vimMode === 'insert' ? P.muted : P.warn}>
            [{vimMode.toUpperCase().slice(0, 1)}]{' '}
          </Text>
        )}
        <Text color={P.primary}>{'> '}</Text>
        <Text color={P.fg}>{props.value || (props.placeholder ?? '')}</Text>
      </Box>
    </Box>
  )
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
