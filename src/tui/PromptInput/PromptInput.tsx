// src/tui/PromptInput/PromptInput.tsx
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Box, Text, useCursor, useInput, useStdout, type DOMElement } from 'ink'
import { homedir } from 'node:os'
import stringWidth from 'string-width'
import { defaultPalette as P } from '../theme'
import { useInputHistory } from './useInputHistory'
import { fuzzyFileSearch } from './fuzzyFileSearch'
import { makeState, step, type State as VimState, type Key as VimKey } from '../../core/vim/controller'
import { bufferToText } from '../../core/vim/mode'
import {
  buildResolver,
  readUserBindings,
  type KeybindingResolver,
  type KeybindingAction,
  type KeybindingContext,
} from '../../core/keybindings'
import type { SlashRegistry } from '../../slash/registry'
import {
  MentionPalette,
  optionToToken,
  usePromptMention,
  type PromptMentionLoaders,
} from '../promptMentions'
import { createPromptDraft, syncPromptDraftText } from '../../promptContextReferences/draft'
import type {
  PromptDraft,
  PromptReferenceToken,
} from '../../promptContextReferences/types'
import type { PromptMentionOption } from '../../promptContextReferences/palette'

/**
 * Width-aware left-truncation: returns the tail of `s` that fits in
 * `maxWidth` columns (using `string-width` to handle CJK/emoji).
 * Walks codepoints from the right and accumulates display width until the
 * next codepoint would exceed `maxWidth`. The caller is expected to prepend
 * an ellipsis (the budget passed in should already exclude its width).
 */
export function truncateLeftToFit(s: string, maxWidth: number): string {
  if (maxWidth <= 0) return ''
  // Array.from splits surrogate pairs into single codepoints, which is
  // sufficient for CJK + most emoji width math.
  const chars = Array.from(s)
  let width = 0
  let i = chars.length
  while (i > 0) {
    const ch = chars[i - 1]!
    const w = stringWidth(ch)
    if (width + w > maxWidth) break
    width += w
    i--
  }
  return chars.slice(i).join('')
}

type Position = { x: number; y: number }
type CursorLayout = Position & { yOffset: number }

function visibleInput(input: string): string {
  return input.replace(/[\u0000-\u001f\u007f]/g, '')
}

export type PromptNavigationAction = 'page-up' | 'page-down' | 'home' | 'end'

export function promptNavigationAction(
  input: string,
  key: Record<string, unknown>,
): PromptNavigationAction | null {
  if (key.pageUp === true || input === '\u001B[5~' || input === '[5~') return 'page-up'
  if (key.pageDown === true || input === '\u001B[6~' || input === '[6~') return 'page-down'
  if (key.home === true || input === '\u001B[H' || input === '\u001B[1~' || input === '[H' || input === '[1~') return 'home'
  if (key.end === true || input === '\u001B[F' || input === '\u001B[4~' || input === '[F' || input === '[4~') return 'end'
  return null
}

function getAbsolutePosition(node: DOMElement | null): Position | null {
  let current: DOMElement | undefined = node ?? undefined
  let x = 0
  let y = 0

  while (current?.parentNode) {
    const yogaNode = current.yogaNode
    if (!yogaNode) return null
    x += yogaNode.getComputedLeft()
    y += yogaNode.getComputedTop()
    current = current.parentNode
  }

  return { x, y }
}

function getRootHeight(node: DOMElement | null): number | null {
  let current: DOMElement | undefined = node ?? undefined
  let root: DOMElement | undefined = current

  while (current?.parentNode) {
    current = current.parentNode
    root = current
  }

  return root?.yogaNode?.getComputedHeight() ?? null
}

function getFullscreenCursorYOffset(
  node: DOMElement | null,
  stdout: NodeJS.WriteStream | undefined,
): number {
  const rows = typeof stdout?.rows === 'number' ? stdout.rows : undefined
  if (stdout?.isTTY !== true || rows === undefined || rows <= 0) return 0

  const rootHeight = getRootHeight(node)
  // Ink omits the trailing newline when output fills the terminal. Cursor
  // movement then starts on the last output row, so absolute y needs +1.
  return rootHeight !== null && rootHeight >= rows ? 1 : 0
}

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
  /**
   * Notified when a non-file mention (diff / staged / git / commit / url
   * / image) is accepted. The host accumulates these tokens and resolves
   * them at submit time via `promptContextReferences/inlineReferences`.
   * file-kind mentions are *not* routed here — they keep the existing
   * `onAttachFile` contract so submit-time file inlining is unchanged.
   */
  onAttachReference?: (token: PromptReferenceToken) => void
  /** When true, route keystrokes through the vim controller. Defaults to false. */
  vim?: boolean
  /** Slash registry — when provided, typing `/` shows command suggestions. */
  slash?: SlashRegistry
  /** Notified whenever the slash submenu opens/closes; lets parent hide chrome. */
  onSlashActiveChange?: (active: boolean) => void
  /** Notified whenever the slash cursor index changes; lets parent render SlashCard. */
  onSlashCursorChange?: (cursor: number) => void
  /**
   * Iter MMMM — pulse on every user input edge (keypress / submit).
   * Wired in cli.tsx to `IdleAwaySummaryHook.poke()` so the away-summary
   * watcher can detect "user returned" after the threshold elapses.
   * Optional; absent in tests and when no awaySummary runner is bound.
   * Called from inside the `useInput` handler so it fires on every
   * recognized keystroke (typing, arrows, Enter, Esc, Tab, backspace).
   */
  onUserInput?: () => void
  /** Notified when terminal navigation keys should move the conversation view. */
  onConversationNavigate?: (action: PromptNavigationAction) => void
}

export function PromptInput(props: PromptInputProps): React.JSX.Element {
  const history = useInputHistory()
  const inputLineRef = useRef<DOMElement | null>(null)
  const inputLineLayoutRef = useRef<CursorLayout | null>(null)
  const [inputLineLayout, setInputLineLayout] = useState<CursorLayout | null>(null)
  const { setCursorPosition } = useCursor()

  // Env-gated user-overridable keybinding resolver. When NUKA_KEYBINDINGS is
  // unset (default) we leave `resolver` as null and the legacy hardcoded
  // branches below run unchanged. When set to '1' we load
  // ~/.nuka/keybindings.yaml asynchronously; until it loads, resolver is null
  // (preserving legacy behavior on first paint).
  const [resolver, setResolver] = useState<KeybindingResolver | null>(null)
  useEffect(() => {
    if (process.env.NUKA_KEYBINDINGS !== '1') {
      setResolver(null)
      return
    }
    let cancelled = false
    void readUserBindings(homedir())
      .then(user => { if (!cancelled) setResolver(() => buildResolver(user)) })
      .catch(() => { if (!cancelled) setResolver(() => buildResolver(null)) })
    return () => { cancelled = true }
  }, [])

  const [slashCursor, setSlashCursor] = useState(0)

  // ---------------------------------------------------------------------------
  // @-mention palette wiring (iter 3b)
  //
  // The legacy bespoke `@…` file-suggest path was replaced with the
  // promptMentions hook + palette. The hook auto-detects the trigger from
  // (input, cursorOffset), so we don't manually watch for `@` here — we just
  // keep cursorOffset in sync with the controlled value and keep an internal
  // PromptDraft mirror. On accept the hook mutates `draft` *and* calls back
  // into the parent's onChange via onInputChange.
  //
  // onAttachFile is preserved: when a file option is accepted we push its
  // label into pendingAttachments via the existing callback, so handleSubmit
  // in App.tsx keeps inlining file contents on submit (its current contract).
  // ---------------------------------------------------------------------------
  const [draft, setDraft] = useState<PromptDraft>(() => createPromptDraft(props.value))
  const [cursorOffset, setCursorOffset] = useState<number>(() => props.value.length)

  // Keep cursorOffset clamped to value when value shrinks below it (e.g.
  // history nav, slash clear). Append-only typing tracks length naturally.
  useEffect(() => {
    setCursorOffset(co => (co > props.value.length ? props.value.length : co))
  }, [props.value])

  // Reconcile internal draft when external value diverges (history nav,
  // slash clear, external clear after submit, controlled tests).
  useEffect(() => {
    if (draft.text !== props.value) {
      setDraft(d => syncPromptDraftText(d, props.value, Math.min(cursorOffset, props.value.length)))
    }
    // We intentionally don't depend on `draft` here — `setDraft` updater
    // reads the latest value and we only want to re-run on external changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.value])

  const mentionLoaders = useMemo<PromptMentionLoaders>(() => ({
    loadFileOptions: async (type, query): Promise<PromptMentionOption[]> => {
      // Reuse the existing fuzzy walker — only files exist today; folder /
      // image are emitted by the same walker as plain paths, so we surface
      // them under the requested type with neutral scoring. The palette
      // ranks the rest.
      const cwd = props.cwd ?? process.cwd()
      const results = await fuzzyFileSearch({ query, cwd, limit: 20 })
      return results.map((label, idx) => ({
        id: `${type}-${label}`,
        type,
        label,
        exactMatch: label === query,
        prefixMatch: query.length > 0 && label.toLowerCase().startsWith(query.toLowerCase()),
        fuzzyScore: 1,
        recentScore: results.length - idx,
      }))
    },
  }), [props.cwd])

  const mention = usePromptMention({
    input: props.value,
    cursorOffset,
    draft,
    onDraftChange: setDraft,
    onInputChange: nextValue => {
      props.onChange(nextValue)
    },
    setCursorOffset,
    loaders: mentionLoaders,
  })

  // Stable accept that also notifies the host:
  //   - file mentions  → onAttachFile (legacy contract — App.tsx inlines
  //                      file contents at submit via `pendingAttachments`)
  //   - non-file kinds → onAttachReference with the resolved token; App.tsx
  //                      runs the resolver at submit via
  //                      `promptContextReferences/inlineReferences`.
  // The two paths are mutually exclusive per accepted option.
  const acceptMention = useCallback(() => {
    const sel = mention.selectedOption
    mention.acceptSelection()
    if (!sel) return
    if (sel.type === 'file') {
      if (props.onAttachFile) {
        props.onAttachFile(sel.label)
      }
      return
    }
    if (props.onAttachReference) {
      props.onAttachReference(optionToToken(sel))
    }
  }, [mention, props])

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
    // Turn 14 fix — keep `cursorOffset` (owned by PromptInput, consumed by
    // usePromptMention's trigger detector) in sync with the vim buffer's
    // cursor. Without this, vim insert-mode typing updates `props.value`
    // but leaves `cursorOffset` at 0, so `detectPromptMentionQuery` sees
    // an empty prefix and never opens the palette. The flat offset is
    // computed from row/col + line lengths (PromptInput sanitizes CR/LF
    // out of the rendered value but the buffer can still be multi-row
    // mid-paste, so we handle it generically).
    const buf = next.buffer
    let flat = 0
    for (let r = 0; r < buf.cursor.row; r++) {
      flat += (buf.lines[r] ?? '').length + 1 // +1 for the joining '\n'
    }
    flat += buf.cursor.col
    setCursorOffset(flat)
  }

  useInput((input, key) => {
    if (props.disabled) return
    const navigationAction = promptNavigationAction(input, key)
    if (navigationAction !== null) {
      props.onUserInput?.()
      props.onConversationNavigate?.(navigationAction)
      return
    }
    const returnIndex = input.search(/[\r\n]/)
    const inputBeforeReturn = returnIndex >= 0 ? input.slice(0, returnIndex) : ''
    const isReturn = key.return || returnIndex >= 0
    const valueAtReturn = inputBeforeReturn.length > 0
      ? props.value + inputBeforeReturn
      : props.value

    // Iter MMMM — every user input edge resets the awaySummary idle
    // watcher. Called *before* mode-specific branches so vim, mention,
    // slash and normal-mode keystrokes all pulse the watcher uniformly.
    // The callback is `useIdlePoke`-stable in production (no-op when
    // the watcher is absent) so this is safe to call on every key.
    props.onUserInput?.()

    // Env-gated keybindings dispatch (NUKA_KEYBINDINGS=1).
    // When resolver is null (default — env unset, or loader pending) this
    // entire block is skipped and the legacy branches below run unchanged.
    if (resolver) {
      const ctx: KeybindingContext = mention.isOpen
        ? 'Mention'
        : slashActive
          ? 'Slash'
          : props.vim && vimRef.current.buffer.mode !== 'insert'
            ? 'Vim'
            : 'Chat'
      const action: KeybindingAction | null = resolver(input, key, ctx)
      if (action !== null) {
        switch (action) {
          case 'chat:submit':
            if (valueAtReturn.trim()) {
              history.push(valueAtReturn)
              props.onSubmit(valueAtReturn)
            }
            return
          case 'chat:cancel':
            // Fall through to legacy escape handling (vim/mention/slash branches
            // own context-specific cancel semantics).
            break
          case 'history:previous': {
            const prev = history.prev(props.value)
            if (prev !== null) props.onChange(prev)
            return
          }
          case 'history:next': {
            const next = history.next()
            if (next !== null) props.onChange(next)
            return
          }
          case 'mention:dismiss':
            mention.dismiss()
            return
          case 'mention:previous': mention.moveSelection(-1); return
          case 'mention:next':     mention.moveSelection(1);  return
          case 'mention:focusTypes':   mention.focusTypes();   return
          case 'mention:focusResults': mention.focusResults(); return
          case 'mention:accept':       acceptMention();        return
          case 'slash:dismiss':        props.onChange('');     return
          case 'slash:previous':
            setSlashCursor(c => Math.max(0, c - 1))
            return
          case 'slash:next':
            setSlashCursor(c => Math.min(slashCandidates.length - 1, c + 1))
            return
          case 'slash:accept': {
            const chosen = slashCandidates[slashCursor]
            if (chosen) props.onChange('/' + chosen.name + ' ')
            return
          }
          case 'vim:escape':
            applyVimKey({ kind: 'esc' })
            return
          case 'chat:newline':
            // Legacy path appends newline via the normal-mode `input` branch
            // when shift+enter or similar reaches here; fall through.
            break
        }
      }
      // No match — fall through to the legacy branches below unchanged.
    }

    // Vim mode: in normal/visual we route through the controller. In insert
    // we let the existing behavior fall through (typing/backspace/enter all
    // work as before) but we also push the keystroke into the controller
    // so the vim buffer stays in sync for the next mode toggle.
    if (props.vim && !mention.isOpen) {
      const isInsert = vimRef.current.buffer.mode === 'insert'
      // Esc: enter normal mode (no-op if already there).
      if (key.escape) {
        applyVimKey({ kind: 'esc' })
        return
      }
      if (!isInsert) {
        // Normal/Visual mode — eat all keys; submit only on Enter from normal.
        if (isReturn) {
          if (valueAtReturn.trim()) {
            history.push(valueAtReturn)
            props.onSubmit(valueAtReturn)
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
        const printable = visibleInput(input)
        if (printable && !key.ctrl && !key.meta) {
          for (const ch of printable) applyVimKey({ kind: 'char', ch })
          return
        }
        return
      }
      // Insert mode in vim: let typing/backspace go through the controller;
      // Enter still submits via the legacy history+onSubmit logic below; up/down
      // arrows still walk history. We return early so the legacy character-append
      // path doesn't double-apply.
      if (isReturn) {
        if (valueAtReturn.trim()) {
          history.push(valueAtReturn)
          props.onSubmit(valueAtReturn)
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
      const printable = visibleInput(input)
      if (printable && !key.ctrl && !key.meta) {
        for (const ch of printable) applyVimKey({ kind: 'char', ch })
        history.reset()
        return
      }
      return
    }

    // Mention palette: navigation / accept / dismiss while open. We only
    // intercept the keys the palette owns — typing/backspace fall through
    // to the normal append path below, which mutates props.value, which
    // causes the hook to re-detect the trigger (or close it). This keeps
    // the palette reactive without duplicating the typing logic.
    if (mention.isOpen) {
      if (key.escape) {
        mention.dismiss()
        return
      }
      if (key.upArrow) {
        mention.moveSelection(-1)
        return
      }
      if (key.downArrow) {
        mention.moveSelection(1)
        return
      }
      if (key.leftArrow) {
        mention.focusTypes()
        return
      }
      if (key.rightArrow) {
        mention.focusResults()
        return
      }
      if (key.tab) {
        // Tab from types pane focuses results; Tab from results accepts.
        if (mention.focusedPane === 'types') {
          mention.focusResults()
        } else {
          acceptMention()
        }
        return
      }
      if (isReturn) {
        acceptMention()
        return
      }
      // Typing / backspace fall through to the normal-mode handlers below
      // so the controlled value changes and the hook re-detects the query.
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
    if (isReturn) {
      if (valueAtReturn.trim()) {
        // If in slash list mode and a candidate is highlighted but the typed
        // text doesn't exactly match a command, expand to the highlighted one.
        let toSubmit = valueAtReturn
        const argHintMode = slashActive && valueAtReturn.includes(' ')
        if (slashActive && !argHintMode && slashCandidates.length > 0) {
          const exact = slashCandidates.find(c => '/' + c.name === valueAtReturn)
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
      const nextValue = props.value.slice(0, -1)
      props.onChange(nextValue)
      setCursorOffset(nextValue.length)
      return
    }
    const printable = visibleInput(input)
    if (!key.ctrl && !key.meta && printable) {
      history.reset()
      // @-trigger detection is performed inside usePromptMention via
      // (input, cursorOffset). We just append the character and update
      // the cursor — the hook does the rest.
      const nextValue = props.value + printable
      props.onChange(nextValue)
      setCursorOffset(nextValue.length)
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
  // borders(2) + paddingX(2) + "> "(2) + cursor(1) + safety(1) = 8.
  // When vim mode is on, the "[I] " / "[N] " badge adds 4 more visible cols,
  // so reserve those too — otherwise the truncation budget is too generous
  // and the rendered value wraps past the bottom border.
  const CHROME = props.vim ? 12 : 8
  const visibleBudget = Math.max(8, columns - CHROME)
  // Width-aware truncation: CJK/emoji glyphs occupy 2 cols each, so a naive
  // `value.length` slice would still wrap. Use string-width via
  // `truncateLeftToFit` to reserve 1 col for the leading "…" indicator.
  // Strip CR/LF from the rendered value so a pasted multi-line string can't
  // wrap past the bottom border. props.value is unchanged (still submitted
  // as-is on Enter); only the *display* is single-lined.
  const sanitizedValue = props.value.replace(/[\r\n]+/g, ' ')
  const valueWidth = stringWidth(sanitizedValue)
  const valueText = valueWidth > visibleBudget
    ? '…' + truncateLeftToFit(sanitizedValue, visibleBudget - 1)
    : sanitizedValue
  const promptPrefixWidth = (props.vim ? 4 : 0) + stringWidth('> ')
  const cursorColumn = promptPrefixWidth + stringWidth(valueText)

  useLayoutEffect(() => {
    const position = getAbsolutePosition(inputLineRef.current)
    const next = position
      ? {
          ...position,
          yOffset: getFullscreenCursorYOffset(inputLineRef.current, stdout),
        }
      : null
    const prev = inputLineLayoutRef.current
    if (prev?.x === next?.x && prev?.y === next?.y && prev?.yOffset === next?.yOffset) return
    inputLineLayoutRef.current = next
    setInputLineLayout(next)
  })

  setCursorPosition(
    showCursor && inputLineLayout
      ? { x: inputLineLayout.x + cursorColumn, y: inputLineLayout.y + inputLineLayout.yOffset }
      : undefined,
  )

  // Defensive guard: lower each option to its token and drop any whose
  // resolved kind is `mcp_resource`. mcp_resource isn't in
  // PROMPT_MENTION_TYPES today so optionToToken's static return type
  // can't widen to it — but a future resolver could grow the surface,
  // and the practical track owns the mcp_resource removal in
  // src/promptContextReferences/types.ts. Until then we filter
  // structurally via a string-typed copy of the kind so this stays a
  // defensive no-op rather than dead code under strict TS.
  const visibleMentionOptions = useMemo(() => {
    return mention.options.filter(o => {
      const kind: string = optionToToken(o).kind
      return kind !== 'mcp_resource'
    })
  }, [mention.options])

  return (
    <Box flexDirection="column" flexShrink={0}>
      {mention.isOpen && (
        <MentionPalette
          activeType={mention.activeType}
          focusedPane={mention.focusedPane}
          options={visibleMentionOptions}
          selectedIndex={mention.selectedIndex}
          preview={mention.preview}
          types={mention.types}
        />
      )}
      <Box
        borderStyle="round"
        borderColor={(props.focused ?? !props.disabled) ? P.primary : P.fgMuted}
        paddingX={1}
        flexShrink={0}
      >
        <Box ref={inputLineRef} flexDirection="row" flexShrink={0}>
          {props.vim && (
            <Text color={vimMode === 'insert' ? P.fgMuted : P.warn} bold>
              [{vimMode.toUpperCase().slice(0, 1)}]{' '}
            </Text>
          )}
          <Text color={P.primary}>{'> '}</Text>
          {isEmpty ? (
            <>
              {showCursor && <Text color={P.fg}> </Text>}
              <Text color={P.fgMuted}>{placeholder}</Text>
            </>
          ) : (
            <Text color={P.fg} wrap="truncate-end">{valueText}</Text>
          )}
        </Box>
      </Box>
    </Box>
  )
}
