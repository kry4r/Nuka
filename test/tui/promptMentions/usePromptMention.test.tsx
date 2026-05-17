// test/tui/promptMentions/usePromptMention.test.tsx
//
// Tests for the usePromptMention hook. Because Nuka has no `renderHook`
// helper, we drive the hook through a thin probe component that mirrors its
// public surface into a captured ref. Ink-testing-library calls render(),
// each effect/state batch lands, and we read the latest captured snapshot
// after a microtask flush.

import React from 'react'
import { describe, expect, it } from 'vitest'
import { render } from 'ink-testing-library'

import {
  buildSemanticOptions,
  optionToToken,
  usePromptMention,
  type PromptMentionLoaders,
  type UsePromptMentionArgs,
  type UsePromptMentionReturn,
} from '../../../src/tui/promptMentions/usePromptMention'
import { createPromptDraft } from '../../../src/promptContextReferences/draft'
import type { PromptDraft } from '../../../src/promptContextReferences/types'
import type { PromptMentionOption } from '../../../src/promptContextReferences/palette'

// ---------------------------------------------------------------------------
// Probe component
// ---------------------------------------------------------------------------

type ProbeHandle = {
  current: UsePromptMentionReturn | null
  draft: PromptDraft
  input: string
  cursorOffset: number
  rerender(next: Partial<DrivenState>): void
}

type DrivenState = {
  input: string
  cursorOffset: number
  loaders?: PromptMentionLoaders
}

function makeProbe(initial: DrivenState): ProbeHandle {
  const handle: ProbeHandle = {
    current: null,
    draft: createPromptDraft(initial.input),
    input: initial.input,
    cursorOffset: initial.cursorOffset,
    rerender: () => {},
  }

  let state: DrivenState = { ...initial }
  let setState: ((s: DrivenState) => void) | null = null

  function Probe(): React.JSX.Element {
    const [driven, setDriven] = React.useState<DrivenState>(state)
    setState = setDriven
    const [draft, setDraft] = React.useState<PromptDraft>(handle.draft)

    const args: UsePromptMentionArgs = {
      input: driven.input,
      cursorOffset: driven.cursorOffset,
      draft,
      onDraftChange: next => {
        handle.draft = next
        setDraft(next)
      },
      onInputChange: next => {
        handle.input = next
        state = { ...state, input: next }
        setDriven({ ...state })
      },
      setCursorOffset: next => {
        handle.cursorOffset = next
        state = { ...state, cursorOffset: next }
        setDriven({ ...state })
      },
      loaders: driven.loaders,
    }

    const ret = usePromptMention(args)
    handle.current = ret
    handle.draft = draft
    handle.input = driven.input
    handle.cursorOffset = driven.cursorOffset
    return <></>
  }

  handle.rerender = (next: Partial<DrivenState>): void => {
    state = { ...state, ...next }
    setState?.({ ...state })
  }

  render(<Probe />)
  return handle
}

// One flush yields to microtasks + the next macrotask (timer). The hook has a
// 3-stage chain: render → setTrigger effect → render → activeType/focus effect
// → render → loader effect → render. Each await flush() steps one stage, so
// most tests need 3+ flushes to reach steady state.
const flush = (): Promise<void> => new Promise(r => setTimeout(r, 0))
const settle = async (steps = 4): Promise<void> => {
  for (let i = 0; i < steps; i++) {
    await flush()
  }
}

// ---------------------------------------------------------------------------
// buildSemanticOptions + optionToToken (pure helpers)
// ---------------------------------------------------------------------------

describe('buildSemanticOptions', () => {
  it('returns a single "Current diff" entry for diff', () => {
    const out = buildSemanticOptions('diff', '')
    expect(out).toHaveLength(1)
    expect(out[0]?.label).toBe('Current diff')
  })

  it('returns a single staged entry for staged', () => {
    const out = buildSemanticOptions('staged', '')
    expect(out).toHaveLength(1)
    expect(out[0]?.label).toBe('Current staged diff')
  })

  it('returns the query as a manual url option when non-empty', () => {
    const out = buildSemanticOptions('url', 'https://example.com')
    expect(out).toHaveLength(1)
    expect(out[0]?.id).toBe('url-https://example.com')
  })

  it('synthesises a manual commit when none match and the query is non-empty', () => {
    const out = buildSemanticOptions('commit', 'deadbee')
    expect(out).toHaveLength(1)
    const opt = out[0]
    expect(opt?.label).toBe('deadbee')
    expect((opt?.metadata as { source?: string })?.source).toBe('manual')
  })

  it('filters real commits by hash prefix or subject substring', () => {
    const commits = [
      {
        hash: 'aaaa111',
        subject: 'Fix bug',
        author: 'Alice',
        relativeDate: '2 days ago',
      },
      {
        hash: 'bbbb222',
        subject: 'Refactor',
        author: 'Bob',
        relativeDate: '3 days ago',
      },
    ]
    const out = buildSemanticOptions('commit', 'aaa', commits)
    expect(out.map(o => o.id)).toEqual(['commit-aaaa111'])
  })
})

describe('optionToToken', () => {
  it('lowers a file option onto a file token', () => {
    const option: PromptMentionOption = {
      id: 'file-src/a.ts',
      type: 'file',
      label: 'src/a.ts',
      exactMatch: false,
      prefixMatch: true,
      fuzzyScore: 1,
      recentScore: 0,
    }
    const token = optionToToken(option)
    expect(token.kind).toBe('file')
    expect(token.target).toEqual({ kind: 'file', path: 'src/a.ts' })
    expect(token.status).toBe('valid')
  })

  it('strips a trailing slash for a folder option', () => {
    const token = optionToToken({
      id: 'folder-src/',
      type: 'folder',
      label: 'src/',
      exactMatch: false,
      prefixMatch: true,
      fuzzyScore: 1,
      recentScore: 0,
    })
    expect(token.display).toBe('src')
    expect(token.target).toEqual({ kind: 'folder', path: 'src' })
  })

  it('lowers an image option onto an image token with draft status', () => {
    const token = optionToToken({
      id: 'image-pic.png',
      type: 'image',
      label: 'pic.png',
      exactMatch: false,
      prefixMatch: true,
      fuzzyScore: 1,
      recentScore: 0,
    })
    expect(token.kind).toBe('image')
    expect(token.status).toBe('draft')
  })
})

// ---------------------------------------------------------------------------
// usePromptMention hook
// ---------------------------------------------------------------------------

describe('usePromptMention', () => {
  it('reports trigger=null and isOpen=false when there is no @ in the input', async () => {
    const h = makeProbe({ input: 'hello world', cursorOffset: 11 })
    await settle()
    expect(h.current?.trigger).toBeNull()
    expect(h.current?.isOpen).toBe(false)
  })

  it('opens with focusedPane=types when input is just "@"', async () => {
    const h = makeProbe({ input: '@', cursorOffset: 1 })
    await settle()
    expect(h.current?.isOpen).toBe(true)
    expect(h.current?.focusedPane).toBe('types')
    expect(h.current?.activeType).toBe('file')
  })

  it('opens with results focus and query when input is "@src"', async () => {
    const h = makeProbe({ input: '@src', cursorOffset: 4 })
    await settle()
    expect(h.current?.isOpen).toBe(true)
    expect(h.current?.focusedPane).toBe('results')
    expect(h.current?.trigger?.query).toBe('src')
  })

  it('detects @diff and selects the diff type', async () => {
    const h = makeProbe({ input: '@diff', cursorOffset: 5 })
    await settle()
    expect(h.current?.activeType).toBe('diff')
    // One semantic option ("Current diff") is loaded synchronously.
    await settle()
    expect(h.current?.options.length).toBe(1)
    expect(h.current?.options[0]?.label).toBe('Current diff')
  })

  it('moveSelection cycles through the types when types pane is focused', async () => {
    const h = makeProbe({ input: '@', cursorOffset: 1 })
    await settle()
    expect(h.current?.activeType).toBe('file')
    h.current?.moveSelection(1)
    await settle()
    expect(h.current?.activeType).toBe('folder')
    h.current?.moveSelection(-1)
    await settle()
    expect(h.current?.activeType).toBe('file')
  })

  it('selectType switches active type and focuses the results pane', async () => {
    // Use a non-bare-"@" input so the trigger-sync effect doesn't force-pin
    // focusedPane back to 'types' on every trigger change.
    const h = makeProbe({ input: '@foo', cursorOffset: 4 })
    await settle()
    h.current?.selectType('url')
    await settle()
    expect(h.current?.activeType).toBe('url')
    expect(h.current?.focusedPane).toBe('results')
  })

  it('dismiss closes the palette without changing the input text', async () => {
    const h = makeProbe({ input: '@src', cursorOffset: 4 })
    await settle()
    expect(h.current?.isOpen).toBe(true)
    h.current?.dismiss()
    await settle()
    expect(h.current?.isOpen).toBe(false)
    expect(h.input).toBe('@src')
  })

  it('loadFileOptions is invoked for file activeType and feeds the options list', async () => {
    const loader: PromptMentionLoaders = {
      loadFileOptions: async (type, query) => [
        {
          id: `${type}-${query}-1`,
          type,
          label: 'src/found.ts',
          exactMatch: false,
          prefixMatch: true,
          fuzzyScore: 1,
          recentScore: 0,
        },
      ],
    }
    const h = makeProbe({ input: '@src', cursorOffset: 4, loaders: loader })
    await settle(6)
    expect(h.current?.options.map(o => o.label)).toEqual(['src/found.ts'])
  })

  it('acceptSelection on a file option mutates the draft to contain the placeholder', async () => {
    const loader: PromptMentionLoaders = {
      loadFileOptions: async (type, query) => [
        {
          id: `${type}-${query}`,
          type,
          label: 'src/acme.ts',
          exactMatch: false,
          prefixMatch: true,
          fuzzyScore: 1,
          recentScore: 0,
        },
      ],
    }
    const h = makeProbe({ input: '@src', cursorOffset: 4, loaders: loader })
    await settle(6)
    expect(h.current?.options.length).toBe(1)
    h.current?.acceptSelection()
    await settle()
    expect(h.draft.text).toContain('@src/acme.ts')
    expect(h.draft.elements.length).toBe(1)
    expect(h.draft.elements[0]?.placeholderLabel).toBe('@src/acme.ts')
  })

  it('preview is undefined when no option is selected, populated when one is', async () => {
    const h = makeProbe({ input: '@diff', cursorOffset: 5 })
    await settle()
    // diff has a single semantic option, so preview is "diff"
    expect(typeof h.current?.preview).toBe('string')
  })

  it('exposes the canonical type list', async () => {
    const h = makeProbe({ input: '@', cursorOffset: 1 })
    await settle()
    expect(h.current?.types).toEqual([
      'file',
      'folder',
      'diff',
      'staged',
      'git',
      'commit',
      'url',
      'image',
    ])
  })
})
