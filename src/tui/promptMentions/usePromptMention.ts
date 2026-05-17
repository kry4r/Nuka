// src/tui/promptMentions/usePromptMention.ts
//
// Glue hook between the @-mention trigger detector, the palette dropdown, and
// the prompt draft state. State machinery only — no React render.
//
// Divergence from upstream `Nuka-Code/src/hooks/usePromptMention.ts`:
//   1. The IO seam (file suggestions, git log) is dependency-injected via
//      the `loaders` prop. Upstream hard-imports `./fileSuggestions.js` and
//      `listRecentCommits`; Nuka doesn't have an equivalent of either yet, so
//      keeping the hook pure-ish lets iter 3b wire whichever real loader the
//      practical track lands on.
//   2. No use of `process.cwd()` in the hot path — the caller passes
//      `cwd` (or nothing for tests) and `loaders` decide what that means.
//   3. `setSelectedIndex` is omitted from the public return surface (the
//      upstream re-export looked like dead API).
//
// The hook does not own keyboard input — it exposes commands (`moveSelection`,
// `acceptSelection`, `dismiss`, `selectType`, `focusTypes`, `focusResults`)
// that the host PromptInput can call from its own `useInput` handler. Iter 3b
// is responsible for that wiring.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  buildPromptInlinePreview,
  buildPromptPlaceholderLabel,
} from '../../promptContextReferences/display'
import { insertPromptElement } from '../../promptContextReferences/draft'
import {
  PROMPT_MENTION_TYPES,
  detectPromptMentionQuery,
  findPromptMentionReplacementEnd,
  rankPromptMentionOptions,
  type PromptMentionOption,
  type PromptMentionPane,
  type PromptMentionTrigger,
  type PromptMentionType,
} from '../../promptContextReferences/palette'
import type {
  PromptDraft,
  PromptReferenceToken,
} from '../../promptContextReferences/types'
import type { RecentCommit } from '../../promptContextReferences/gitLog'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PromptMentionLoaders = {
  /**
   * Resolve file / folder / image suggestions for a given query. Caller
   * decides ranking, fs walk, gitignore handling.
   */
  loadFileOptions?: (
    type: 'file' | 'folder' | 'image',
    query: string,
  ) => Promise<PromptMentionOption[]>
  /**
   * Resolve recent git commits (used for both `commit:` and `git:` panes).
   * Caller may cache.
   */
  loadCommits?: () => Promise<RecentCommit[]>
}

export type UsePromptMentionArgs = {
  input: string
  cursorOffset: number
  draft: PromptDraft
  onDraftChange: (draft: PromptDraft) => void
  onInputChange: (value: string) => void
  setCursorOffset: (offset: number) => void
  loaders?: PromptMentionLoaders
}

export type UsePromptMentionReturn = {
  activeType: PromptMentionType
  acceptSelection: () => void
  dismiss: () => void
  focusResults: () => void
  focusTypes: () => void
  focusedPane: PromptMentionPane
  isOpen: boolean
  moveSelection: (delta: number) => void
  options: PromptMentionOption[]
  preview: string | undefined
  selectType: (type: PromptMentionType) => void
  selectedIndex: number
  selectedOption: PromptMentionOption | undefined
  trigger: PromptMentionTrigger | null
  types: readonly PromptMentionType[]
}

// ---------------------------------------------------------------------------
// Helpers (option → token + semantic option builders)
// ---------------------------------------------------------------------------

export function buildSemanticOptions(
  type: PromptMentionType,
  query: string,
  recentCommits: RecentCommit[] = [],
): PromptMentionOption[] {
  if (type === 'diff') {
    return [
      {
        id: 'diff-current',
        type,
        label: 'Current diff',
        exactMatch: query === '',
        prefixMatch: true,
        fuzzyScore: 1,
        recentScore: 0,
      },
    ]
  }
  if (type === 'staged') {
    return [
      {
        id: 'staged-current',
        type,
        label: 'Current staged diff',
        exactMatch: query === '',
        prefixMatch: true,
        fuzzyScore: 1,
        recentScore: 0,
      },
    ]
  }
  if (type === 'commit') {
    const q = query.toLowerCase()
    const filtered =
      q.length === 0
        ? recentCommits
        : recentCommits.filter(
            c =>
              c.hash.toLowerCase().startsWith(q) ||
              c.subject.toLowerCase().includes(q),
          )
    const mapped: PromptMentionOption[] = filtered.map(c => ({
      id: `commit-${c.hash}`,
      type,
      label: `${c.hash} ${c.subject} (${c.relativeDate} by ${c.author})`,
      exactMatch: c.hash === query,
      prefixMatch: c.hash.startsWith(query),
      fuzzyScore: 1,
      recentScore: 0,
      metadata: {
        hash: c.hash,
        subject: c.subject,
        author: c.author,
        relativeDate: c.relativeDate,
        source: 'palette',
      },
    }))
    if (query.length > 0 && mapped.length === 0) {
      mapped.push({
        id: `commit-${query}`,
        type,
        label: query,
        exactMatch: true,
        prefixMatch: true,
        fuzzyScore: 1,
        recentScore: 0,
        metadata: { hash: query, source: 'manual' },
      })
    }
    return mapped
  }
  if (type === 'git') {
    const mapped: PromptMentionOption[] = recentCommits.map(c => ({
      id: `git-${c.hash}`,
      type,
      label: `${c.hash} ${c.subject} (${c.relativeDate} by ${c.author})`,
      exactMatch: c.hash === query,
      prefixMatch: c.hash.startsWith(query),
      fuzzyScore: 1,
      recentScore: 0,
      metadata: {
        hash: c.hash,
        subject: c.subject,
        author: c.author,
        relativeDate: c.relativeDate,
        revspec: c.hash,
        source: 'palette',
      },
    }))
    if (query.length > 0) {
      mapped.push({
        id: `git-${query}`,
        type,
        label: query,
        exactMatch: true,
        prefixMatch: true,
        fuzzyScore: 1,
        recentScore: 0,
        metadata: { revspec: query, source: 'manual' },
      })
    }
    return mapped
  }
  if (type === 'url') {
    return query
      ? [
          {
            id: `url-${query}`,
            type,
            label: query,
            exactMatch: true,
            prefixMatch: true,
            fuzzyScore: 1,
            recentScore: 0,
          },
        ]
      : []
  }
  return []
}

export function optionToToken(
  option: PromptMentionOption,
): PromptReferenceToken {
  switch (option.type) {
    case 'folder':
      return {
        id: option.id,
        kind: 'folder',
        display: option.label.replace(/[\\/]$/, ''),
        target: {
          kind: 'folder',
          path: option.label.replace(/[\\/]$/, ''),
        },
        resolvePolicy: 'live',
        status: 'valid',
        metadata: {},
      }
    case 'diff':
      return {
        id: option.id,
        kind: 'diff',
        display: 'diff',
        target: { kind: 'diff' },
        resolvePolicy: 'live',
        status: 'valid',
        metadata: {},
      }
    case 'staged':
      return {
        id: option.id,
        kind: 'staged',
        display: 'staged',
        target: { kind: 'staged' },
        resolvePolicy: 'live',
        status: 'valid',
        metadata: {},
      }
    case 'commit': {
      const meta = (option.metadata ?? {}) as {
        hash?: string
        subject?: string
        author?: string
        relativeDate?: string
        source?: 'palette' | 'manual'
      }
      const hash = meta.hash ?? option.label
      return {
        id: option.id,
        kind: 'commit',
        display: hash,
        target: {
          kind: 'commit',
          hash,
          subject: meta.subject,
          author: meta.author,
          relativeDate: meta.relativeDate,
        },
        resolvePolicy: 'live',
        status: 'valid',
        metadata: { source: meta.source ?? 'palette' },
      }
    }
    case 'git': {
      const meta = (option.metadata ?? {}) as {
        revspec?: string
        source?: 'palette' | 'manual'
      }
      const revspec = meta.revspec ?? option.label
      return {
        id: option.id,
        kind: 'git',
        display: revspec,
        target: { kind: 'git', revspec },
        resolvePolicy: 'live',
        status: 'valid',
        metadata: { source: meta.source ?? 'palette' },
      }
    }
    case 'url':
      return {
        id: option.id,
        kind: 'url',
        display: option.label,
        target: { kind: 'url', url: option.label },
        resolvePolicy: 'live',
        status: 'valid',
        metadata: {},
      }
    case 'image':
      return {
        id: option.id,
        kind: 'image',
        display: option.label,
        target: {
          kind: 'image',
          sourceKind: 'local_path',
          path: option.label,
        },
        resolvePolicy: 'live',
        status: 'draft',
        metadata: {},
      }
    case 'file':
    default:
      return {
        id: option.id,
        kind: 'file',
        display: option.label,
        target: { kind: 'file', path: option.label },
        resolvePolicy: 'live',
        status: 'valid',
        metadata: {},
      }
  }
}

function normalizeSelectedIndex(
  current: number,
  optionsLength: number,
): number {
  if (optionsLength === 0) {
    return 0
  }
  if (current < 0) {
    return optionsLength - 1
  }
  if (current >= optionsLength) {
    return 0
  }
  return current
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePromptMention(
  args: UsePromptMentionArgs,
): UsePromptMentionReturn {
  const {
    input,
    cursorOffset,
    draft,
    onDraftChange,
    onInputChange,
    setCursorOffset,
    loaders,
  } = args

  const [trigger, setTrigger] = useState<PromptMentionTrigger | null>(null)
  const [activeType, setActiveType] = useState<PromptMentionType>('file')
  const [focusedPane, setFocusedPane] = useState<PromptMentionPane>('types')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [dismissedTriggerText, setDismissedTriggerText] = useState<
    string | null
  >(null)
  const [manualActiveType, setManualActiveType] =
    useState<PromptMentionType | null>(null)
  const recentCommitsRef = useRef<RecentCommit[] | null>(null)

  // Re-detect trigger whenever input / cursor moves.
  useEffect(() => {
    setTrigger(detectPromptMentionQuery(input, cursorOffset))
  }, [input, cursorOffset])

  // Sync active type / focused pane / selected index when trigger changes.
  useEffect(() => {
    if (!trigger) {
      setDismissedTriggerText(null)
      setManualActiveType(null)
      return
    }
    if (dismissedTriggerText === trigger.triggerText) {
      return
    }
    const hasExplicitTriggerType =
      trigger.triggerText.startsWith('@diff') ||
      trigger.triggerText.startsWith('@staged') ||
      trigger.triggerText.startsWith('@git:') ||
      trigger.triggerText.startsWith('@url:')
    const nextActiveType =
      !hasExplicitTriggerType &&
      manualActiveType &&
      trigger.activeType === 'file'
        ? manualActiveType
        : trigger.activeType

    setActiveType(nextActiveType)
    setFocusedPane(trigger.triggerText === '@' ? 'types' : 'results')
    setSelectedIndex(0)
    if (hasExplicitTriggerType) {
      setManualActiveType(null)
    }
  }, [dismissedTriggerText, manualActiveType, trigger])

  const isOpen =
    trigger !== null && dismissedTriggerText !== trigger.triggerText

  // Load options for the current (trigger, activeType) pair.
  const [options, setOptions] = useState<PromptMentionOption[]>([])
  useEffect(() => {
    if (!isOpen || !trigger) {
      setOptions([])
      setSelectedIndex(0)
      return
    }

    let disposed = false

    const loadCommitsIfNeeded = async (): Promise<RecentCommit[]> => {
      if (recentCommitsRef.current) {
        return recentCommitsRef.current
      }
      const fn = loaders?.loadCommits
      const commits = fn ? await fn() : []
      recentCommitsRef.current = commits
      return commits
    }

    const load = async (): Promise<void> => {
      if (
        activeType === 'file' ||
        activeType === 'folder' ||
        activeType === 'image'
      ) {
        const fn = loaders?.loadFileOptions
        const results = fn ? await fn(activeType, trigger.query) : []
        if (disposed) return
        setOptions(rankPromptMentionOptions(activeType, results))
        return
      }

      if (activeType === 'commit' || activeType === 'git') {
        const commits = await loadCommitsIfNeeded()
        if (disposed) return
        setOptions(
          rankPromptMentionOptions(
            activeType,
            buildSemanticOptions(activeType, trigger.query, commits),
          ),
        )
        return
      }

      setOptions(
        rankPromptMentionOptions(
          activeType,
          buildSemanticOptions(activeType, trigger.query),
        ),
      )
    }

    void load()
    return () => {
      disposed = true
    }
    // loaders is intentionally not in deps — its identity may flip every
    // render at the host but its observable behaviour is stable per cwd.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeType, isOpen, trigger])

  // Clamp selectedIndex when options shrink.
  useEffect(() => {
    setSelectedIndex(current => normalizeSelectedIndex(current, options.length))
  }, [options.length])

  const selectedOption = useMemo(
    () =>
      options.length > 0
        ? options[normalizeSelectedIndex(selectedIndex, options.length)]
        : undefined,
    [options, selectedIndex],
  )

  const preview = useMemo(() => {
    if (!selectedOption) return undefined
    return buildPromptInlinePreview(optionToToken(selectedOption))
  }, [selectedOption])

  const selectType = useCallback((type: PromptMentionType) => {
    setManualActiveType(type)
    setActiveType(type)
    setFocusedPane('results')
    setSelectedIndex(0)
  }, [])

  const moveSelection = useCallback(
    (delta: number) => {
      if (!isOpen) return

      if (focusedPane === 'types') {
        const currentIndex = PROMPT_MENTION_TYPES.indexOf(activeType)
        const nextIndex =
          (currentIndex + delta + PROMPT_MENTION_TYPES.length) %
          PROMPT_MENTION_TYPES.length
        const next = PROMPT_MENTION_TYPES[nextIndex]
        if (!next) return
        setManualActiveType(next)
        setActiveType(next)
        return
      }

      if (options.length === 0) return
      setSelectedIndex(
        current => (current + delta + options.length) % options.length,
      )
    },
    [activeType, focusedPane, isOpen, options.length],
  )

  const focusTypes = useCallback(() => {
    if (!isOpen) return
    setFocusedPane('types')
  }, [isOpen])

  const focusResults = useCallback(() => {
    if (!isOpen) return
    setFocusedPane('results')
  }, [isOpen])

  const acceptSelection = useCallback(() => {
    if (!trigger) return

    if (focusedPane === 'types') {
      setFocusedPane('results')
      return
    }

    if (!selectedOption) return

    const token = optionToToken(selectedOption)
    const nextDraft = insertPromptElement(draft, {
      elementId: token.id,
      token,
      kind: token.kind === 'image' ? 'image' : 'mention',
      placeholderLabel: buildPromptPlaceholderLabel(token),
      replaceRange: {
        start: trigger.triggerStart,
        end: findPromptMentionReplacementEnd(input, cursorOffset),
      },
    })

    onDraftChange(nextDraft)
    onInputChange(nextDraft.text)
    setCursorOffset(nextDraft.cursor.offset)
    setDismissedTriggerText(null)
    setManualActiveType(null)
  }, [
    cursorOffset,
    draft,
    focusedPane,
    input,
    onDraftChange,
    onInputChange,
    selectedOption,
    setCursorOffset,
    trigger,
  ])

  const dismiss = useCallback(() => {
    if (!trigger) return
    setDismissedTriggerText(trigger.triggerText)
    setManualActiveType(null)
    setOptions([])
  }, [trigger])

  return {
    activeType,
    acceptSelection,
    dismiss,
    focusResults,
    focusTypes,
    focusedPane,
    isOpen,
    moveSelection,
    options,
    preview,
    selectType,
    selectedIndex,
    selectedOption,
    trigger,
    types: PROMPT_MENTION_TYPES,
  }
}
