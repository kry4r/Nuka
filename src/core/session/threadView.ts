import type { Message, TokenUsage } from '../message/types'
import type { SessionGoal, SessionMode } from './types'
import type { SessionStore } from './store'

export type ThreadStatus = 'notLoaded' | 'active'
export type ThreadSortDirection = 'asc' | 'desc'

export type ThreadTurn = {
  id: string
  status: 'completed'
  startedAt: number
  updatedAt: number
  messages: Message[]
}

export type ThreadView = {
  id: string
  parentId?: string
  providerId: string
  model: string
  messageCount: number
  totalUsage: TokenUsage
  mode: SessionMode
  goal?: SessionGoal
  status: ThreadStatus
  createdAt: number
  updatedAt: number
  turns: ThreadTurn[]
}

export type ThreadTurnsPage = {
  turns: ThreadTurn[]
  nextCursor?: string
  backwardsCursor?: string
}

export type ThreadListPage = {
  threads: ThreadView[]
  nextCursor?: string
  backwardsCursor?: string
}

export type ThreadReadOptions = {
  includeTurns?: boolean
}

export type ThreadListOptions = {
  cursor?: string
  limit?: number
  sortDirection?: ThreadSortDirection
  providerIds?: readonly string[]
  models?: readonly string[]
  searchTerm?: string
}

export type ThreadTurnsListOptions = {
  cursor?: string
  limit?: number
  sortDirection?: ThreadSortDirection
}

type ThreadTurnsCursor = {
  turnId: string
  includeAnchor: boolean
}

type ThreadListCursor = {
  threadId: string
  includeAnchor: boolean
}

const DEFAULT_TURNS_LIMIT = 20
const MAX_TURNS_LIMIT = 100
const DEFAULT_THREADS_LIMIT = 20
const MAX_THREADS_LIMIT = 100

export class ThreadViewStore {
  private readonly store: SessionStore

  constructor(opts: { store: SessionStore }) {
    this.store = opts.store
  }

  async read(
    threadId: string,
    opts: ThreadReadOptions = {},
  ): Promise<ThreadView | null> {
    const meta = await this.store.readMeta(threadId)
    if (!meta) return null
    const turns = opts.includeTurns
      ? buildTurns(await this.store.readMessages(threadId))
      : []
    return {
      id: meta.id,
      parentId: meta.parentId,
      providerId: meta.providerId,
      model: meta.model,
      messageCount: meta.messageCount,
      totalUsage: { ...meta.totalUsage },
      mode: meta.mode,
      goal: meta.goal ? { ...meta.goal } : undefined,
      status: 'notLoaded',
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      turns,
    }
  }

  async list(opts: ThreadListOptions = {}): Promise<ThreadListPage> {
    const metas = await this.store.list()
    let threads: ThreadView[] = []
    for (const meta of metas) {
      const messages = opts.searchTerm
        ? await this.store.readMessages(meta.id)
        : undefined
      if (!matchesThreadFilters(meta, messages, opts)) continue
      threads.push({
        id: meta.id,
        parentId: meta.parentId,
        providerId: meta.providerId,
        model: meta.model,
        messageCount: meta.messageCount,
        totalUsage: { ...meta.totalUsage },
        mode: meta.mode,
        goal: meta.goal ? { ...meta.goal } : undefined,
        status: 'notLoaded',
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        turns: [],
      })
    }
    threads = [...threads].reverse()
    return paginateThreads(threads, opts)
  }

  async listTurns(
    threadId: string,
    opts: ThreadTurnsListOptions = {},
  ): Promise<ThreadTurnsPage> {
    const meta = await this.store.readMeta(threadId)
    if (!meta) throw new Error(`thread not found: ${threadId}`)
    return paginateTurns(
      buildTurns(await this.store.readMessages(threadId)),
      opts,
    )
  }
}

function matchesThreadFilters(
  meta: {
    providerId: string
    model: string
  },
  messages: readonly Message[] | undefined,
  opts: ThreadListOptions,
): boolean {
  if (opts.providerIds && !opts.providerIds.includes(meta.providerId)) return false
  if (opts.models && !opts.models.includes(meta.model)) return false
  const needle = opts.searchTerm?.trim().toLowerCase()
  if (!needle) return true
  return (messages ?? []).some(message =>
    messageToSearchText(message).toLowerCase().includes(needle),
  )
}

function buildTurns(messages: readonly Message[]): ThreadTurn[] {
  const turns: ThreadTurn[] = []
  let current: ThreadTurn | undefined
  for (const message of messages) {
    if (message.role === 'user') {
      current = {
        id: message.id,
        status: 'completed',
        startedAt: message.ts,
        updatedAt: message.ts,
        messages: [message],
      }
      turns.push(current)
      continue
    }
    if (!current) continue
    current.messages.push(message)
    current.updatedAt = messageTime(message) ?? current.updatedAt
  }
  return turns
}

function paginateThreads(
  threads: ThreadView[],
  opts: ThreadListOptions,
): ThreadListPage {
  if (threads.length === 0) {
    return { threads: [] }
  }

  const anchor = opts.cursor ? parseThreadListCursor(opts.cursor) : undefined
  const anchorIndex = anchor
    ? threads.findIndex(thread => thread.id === anchor.threadId)
    : -1
  if (anchor && anchorIndex < 0) {
    throw new Error('invalid cursor: anchor thread is no longer present')
  }

  const pageSize = clampLimit(opts.limit, DEFAULT_THREADS_LIMIT, MAX_THREADS_LIMIT)
  let keyedThreads = threads.map((thread, index) => ({ index, thread }))
  if ((opts.sortDirection ?? 'desc') === 'asc') {
    if (anchor) {
      keyedThreads = keyedThreads.filter(({ index }) =>
        anchor.includeAnchor ? index >= anchorIndex : index > anchorIndex,
      )
    }
  } else {
    keyedThreads.reverse()
    if (anchor) {
      keyedThreads = keyedThreads.filter(({ index }) =>
        anchor.includeAnchor ? index <= anchorIndex : index < anchorIndex,
      )
    }
  }

  const hasMore = keyedThreads.length > pageSize
  keyedThreads = keyedThreads.slice(0, pageSize)
  return {
    threads: keyedThreads.map(({ thread }) => thread),
    backwardsCursor: keyedThreads[0]
      ? serializeThreadListCursor({
          threadId: keyedThreads[0].thread.id,
          includeAnchor: true,
        })
      : undefined,
    nextCursor: hasMore && keyedThreads[keyedThreads.length - 1]
      ? serializeThreadListCursor({
          threadId: keyedThreads[keyedThreads.length - 1]!.thread.id,
          includeAnchor: false,
        })
      : undefined,
  }
}

function paginateTurns(
  turns: ThreadTurn[],
  opts: ThreadTurnsListOptions,
): ThreadTurnsPage {
  if (turns.length === 0) {
    return { turns: [] }
  }

  const anchor = opts.cursor ? parseCursor(opts.cursor) : undefined
  const anchorIndex = anchor
    ? turns.findIndex(turn => turn.id === anchor.turnId)
    : -1
  if (anchor && anchorIndex < 0) {
    throw new Error('invalid cursor: anchor turn is no longer present')
  }

  const pageSize = clampLimit(opts.limit, DEFAULT_TURNS_LIMIT, MAX_TURNS_LIMIT)
  let keyedTurns = turns.map((turn, index) => ({ index, turn }))
  if ((opts.sortDirection ?? 'desc') === 'asc') {
    if (anchor) {
      keyedTurns = keyedTurns.filter(({ index }) =>
        anchor.includeAnchor ? index >= anchorIndex : index > anchorIndex,
      )
    }
  } else {
    keyedTurns.reverse()
    if (anchor) {
      keyedTurns = keyedTurns.filter(({ index }) =>
        anchor.includeAnchor ? index <= anchorIndex : index < anchorIndex,
      )
    }
  }

  const hasMore = keyedTurns.length > pageSize
  keyedTurns = keyedTurns.slice(0, pageSize)
  return {
    turns: keyedTurns.map(({ turn }) => turn),
    backwardsCursor: keyedTurns[0]
      ? serializeCursor({ turnId: keyedTurns[0].turn.id, includeAnchor: true })
      : undefined,
    nextCursor: hasMore && keyedTurns[keyedTurns.length - 1]
      ? serializeCursor({
          turnId: keyedTurns[keyedTurns.length - 1]!.turn.id,
          includeAnchor: false,
        })
      : undefined,
  }
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.min(max, Math.trunc(value)))
}

function serializeThreadListCursor(cursor: ThreadListCursor): string {
  return JSON.stringify(cursor)
}

function serializeCursor(cursor: ThreadTurnsCursor): string {
  return JSON.stringify(cursor)
}

function parseThreadListCursor(raw: string): ThreadListCursor {
  try {
    const parsed = JSON.parse(raw) as Partial<ThreadListCursor>
    if (
      typeof parsed.threadId === 'string' &&
      typeof parsed.includeAnchor === 'boolean'
    ) {
      return { threadId: parsed.threadId, includeAnchor: parsed.includeAnchor }
    }
  } catch {
    // Fall through to the uniform error below.
  }
  throw new Error(`invalid cursor: ${raw}`)
}

function parseCursor(raw: string): ThreadTurnsCursor {
  try {
    const parsed = JSON.parse(raw) as Partial<ThreadTurnsCursor>
    if (
      typeof parsed.turnId === 'string' &&
      typeof parsed.includeAnchor === 'boolean'
    ) {
      return { turnId: parsed.turnId, includeAnchor: parsed.includeAnchor }
    }
  } catch {
    // Fall through to the uniform error below.
  }
  throw new Error(`invalid cursor: ${raw}`)
}

function messageTime(message: Message): number | undefined {
  return 'ts' in message ? message.ts : undefined
}

function messageToSearchText(message: Message): string {
  if (message.role === 'system') return message.content
  if (message.role === 'tool') {
    return typeof message.content === 'string'
      ? message.content
      : message.content.map(block => block.type === 'text' ? block.text : JSON.stringify(block)).join('\n')
  }
  if (message.role === 'responses_compaction') return JSON.stringify(message.output)
  return message.content.map(block => {
    if (block.type === 'text') return block.text
    if (block.type === 'tool_use') return `${block.name} ${JSON.stringify(block.input)}`
    if (block.type === 'image') return block.url ?? block.mediaType
    return ''
  }).join('\n')
}
