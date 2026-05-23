import type { Message, TokenUsage } from '../message/types'
import type { SessionMode } from './types'
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

export type ThreadReadOptions = {
  includeTurns?: boolean
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

const DEFAULT_TURNS_LIMIT = 20
const MAX_TURNS_LIMIT = 100

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
      status: 'notLoaded',
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      turns,
    }
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

  const pageSize = clampLimit(opts.limit)
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

function clampLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_TURNS_LIMIT
  return Math.max(1, Math.min(MAX_TURNS_LIMIT, Math.trunc(value)))
}

function serializeCursor(cursor: ThreadTurnsCursor): string {
  return JSON.stringify(cursor)
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
