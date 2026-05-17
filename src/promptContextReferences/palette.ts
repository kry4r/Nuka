/**
 * Pure scoring / filtering / trigger detection for the @-mention palette.
 *
 * No IO — safe to call from render paths and unit-testable in isolation.
 * Ported from Nuka-Code with no behavioural change.
 */

export const PROMPT_MENTION_TYPES = [
  'file',
  'folder',
  'diff',
  'staged',
  'git',
  'commit',
  'url',
  'image',
] as const

export type PromptMentionType = (typeof PROMPT_MENTION_TYPES)[number]
export type PromptMentionPane = 'types' | 'results'

export type PromptMentionTrigger = {
  triggerStart: number
  triggerText: string
  activeType: PromptMentionType
  query: string
  focusedPane: PromptMentionPane
}

export type PromptMentionOption = {
  id: string
  type: PromptMentionType
  label: string
  description?: string
  exactMatch: boolean
  prefixMatch: boolean
  fuzzyScore: number
  recentScore: number
  metadata?: Record<string, unknown>
}

const PROMPT_MENTION_RE = /(^|\s)(@"[^"]*"?|@[^ \t\r\n]*)$/

export function detectPromptMentionQuery(
  text: string,
  cursorOffset: number,
): PromptMentionTrigger | null {
  const prefix = text.slice(0, cursorOffset)
  const match = prefix.match(PROMPT_MENTION_RE)
  if (!match || match.index === undefined) {
    return null
  }

  const triggerText = match[2]
  if (!triggerText) {
    return null
  }

  const triggerStart = prefix.length - triggerText.length
  if (triggerText === '@') {
    return {
      triggerStart,
      triggerText,
      activeType: 'file',
      query: '',
      focusedPane: 'types',
    }
  }

  if (triggerText.startsWith('@"')) {
    return {
      triggerStart,
      triggerText,
      activeType: 'file',
      query: triggerText.slice(2).replace(/"$/, ''),
      focusedPane: 'results',
    }
  }

  if (triggerText === '@diff') {
    return {
      triggerStart,
      triggerText,
      activeType: 'diff',
      query: '',
      focusedPane: 'results',
    }
  }

  if (triggerText === '@staged') {
    return {
      triggerStart,
      triggerText,
      activeType: 'staged',
      query: '',
      focusedPane: 'results',
    }
  }

  if (triggerText.startsWith('@git:')) {
    return {
      triggerStart,
      triggerText,
      activeType: 'git',
      query: triggerText.slice('@git:'.length),
      focusedPane: 'results',
    }
  }

  if (triggerText.startsWith('@commit:')) {
    return {
      triggerStart,
      triggerText,
      activeType: 'commit',
      query: triggerText.slice('@commit:'.length),
      focusedPane: 'results',
    }
  }

  if (triggerText.startsWith('@url:')) {
    return {
      triggerStart,
      triggerText,
      activeType: 'url',
      query: triggerText.slice('@url:'.length),
      focusedPane: 'results',
    }
  }

  return {
    triggerStart,
    triggerText,
    activeType: 'file',
    query: triggerText.slice(1),
    focusedPane: 'results',
  }
}

export function rankPromptMentionOptions(
  activeType: PromptMentionType,
  options: PromptMentionOption[],
): PromptMentionOption[] {
  return [...options].sort((left, right) => {
    if (left.type !== right.type) {
      if (left.type === activeType) {
        return -1
      }
      if (right.type === activeType) {
        return 1
      }
      return left.type.localeCompare(right.type)
    }

    if (left.exactMatch !== right.exactMatch) {
      return Number(right.exactMatch) - Number(left.exactMatch)
    }
    if (left.prefixMatch !== right.prefixMatch) {
      return Number(right.prefixMatch) - Number(left.prefixMatch)
    }
    if (left.fuzzyScore !== right.fuzzyScore) {
      return right.fuzzyScore - left.fuzzyScore
    }
    if (left.recentScore !== right.recentScore) {
      return right.recentScore - left.recentScore
    }

    return left.label.localeCompare(right.label)
  })
}

export function findPromptMentionReplacementEnd(
  text: string,
  cursorOffset: number,
): number {
  const prefix = text.slice(0, cursorOffset)
  const after = text.slice(cursorOffset)

  if (/(^|\s)@"[^"]*$/u.test(prefix)) {
    const quotedSuffix = after.match(/^[^"]*"?/u)?.[0] ?? ''
    return cursorOffset + quotedSuffix.length
  }

  const tokenSuffix = after.match(/^[^ \t\r\n]*/u)?.[0] ?? ''
  return cursorOffset + tokenSuffix.length
}
