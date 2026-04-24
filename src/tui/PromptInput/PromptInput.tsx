// src/tui/PromptInput/PromptInput.tsx
import React, { useState, useEffect } from 'react'
import { Box, Text, useInput } from 'ink'
import { defaultPalette as P } from '../theme'
import { useInputHistory } from './useInputHistory'
import { MentionPanel } from './MentionPanel'
import { fuzzyFileSearch } from './fuzzyFileSearch'

export type PromptInputProps = {
  value: string
  onChange: (v: string) => void
  onSubmit: (v: string) => void
  disabled: boolean
  placeholder?: string
  cwd?: string
  onAttachFile?: (path: string) => void
}

export function PromptInput(props: PromptInputProps): React.JSX.Element {
  const history = useInputHistory()

  const [mentionActive, setMentionActive] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionMatches, setMentionMatches] = useState<string[]>([])
  const [mentionCursor, setMentionCursor] = useState(0)

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
        <Text color={P.primary}>{'> '}</Text>
        <Text color={P.fg}>{props.value || (props.placeholder ?? '')}</Text>
      </Box>
    </Box>
  )
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
