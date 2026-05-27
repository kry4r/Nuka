// src/core/session/history/store.ts
//
// B4 — Read-side facade over SessionStore. Adds previews (first user
// message text, truncated) and a uniform delete operation. Persistence
// is unchanged: `cli.tsx` still wires `SessionStore` + `DebouncedMetaWriter`
// behind the NUKA_SESSION_PERSIST gate.

import type { Message } from '../../message/types'
import { SessionStore } from '../store'
import { PREVIEW_LEN } from './types'
import type {
  SessionId,
  HistoryListEntry,
  HistoryRecord,
} from './types'

function truncate(text: string, max: number): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= max) return trimmed
  return trimmed.slice(0, max - 1) + '\u2026'
}

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

function firstUserText(messages: Message[]): string {
  for (const m of messages) {
    if (m.role !== 'user') continue
    for (const block of m.content) {
      if (block.type === 'text' && block.text.trim().length > 0) {
        return block.text
      }
    }
  }
  return ''
}

function messageSearchText(message: Message): string {
  if (message.role === 'system') return message.content
  if (message.role === 'tool') {
    return typeof message.content === 'string' ? message.content : ''
  }
  if (message.role === 'responses_compaction') return ''
  return message.content
    .map(block => block.type === 'text' ? block.text : '')
    .filter(Boolean)
    .join('\n')
}

function matchPreview(messages: Message[], query: string): string {
  const needle = query.toLocaleLowerCase()
  for (const message of messages) {
    const text = normalizeText(messageSearchText(message))
    if (!text) continue
    const index = text.toLocaleLowerCase().indexOf(needle)
    if (index < 0) continue
    const context = Math.max(8, Math.floor((PREVIEW_LEN - query.length) / 2))
    const start = Math.max(0, index - context)
    const end = Math.min(text.length, index + query.length + context)
    const prefix = start > 0 ? '\u2026' : ''
    const suffix = end < text.length ? '\u2026' : ''
    return truncate(`${prefix}${text.slice(start, end)}${suffix}`, PREVIEW_LEN)
  }
  return ''
}

export class HistoryStore {
  private store: SessionStore

  constructor(opts: { store: SessionStore }) {
    this.store = opts.store
  }

  async list(): Promise<HistoryListEntry[]> {
    const metas = await this.store.list() // newest-first
    const out: HistoryListEntry[] = []
    for (const meta of metas) {
      let preview = ''
      try {
        const msgs = await this.store.readMessages(meta.id)
        preview = truncate(firstUserText(msgs), PREVIEW_LEN)
      } catch {
        preview = ''
      }
      out.push({
        id: meta.id as SessionId,
        providerId: meta.providerId,
        model: meta.model,
        messageCount: meta.messageCount,
        preview,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
      })
    }
    return out
  }

  async search(query: string): Promise<HistoryListEntry[]> {
    const normalizedQuery = normalizeText(query)
    if (!normalizedQuery) return this.list()
    const metas = await this.store.list() // newest-first
    const out: HistoryListEntry[] = []
    for (const meta of metas) {
      let msgs: Message[] = []
      try {
        msgs = await this.store.readMessages(meta.id)
      } catch {
        msgs = []
      }
      const preview = matchPreview(msgs, normalizedQuery)
      if (!preview) continue
      out.push({
        id: meta.id as SessionId,
        providerId: meta.providerId,
        model: meta.model,
        messageCount: meta.messageCount,
        preview: preview || truncate(firstUserText(msgs), PREVIEW_LEN),
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
      })
    }
    return out
  }

  async read(id: SessionId): Promise<HistoryRecord | null> {
    const meta = await this.store.readMeta(id)
    if (!meta) return null
    let preview = ''
    try {
      const msgs = await this.store.readMessages(id)
      preview = truncate(firstUserText(msgs), PREVIEW_LEN)
    } catch {
      preview = ''
    }
    return {
      id: meta.id as SessionId,
      providerId: meta.providerId,
      model: meta.model,
      mode: meta.mode,
      messageCount: meta.messageCount,
      totalUsage: { ...meta.totalUsage },
      preview,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
    }
  }

  async delete(id: SessionId): Promise<void> {
    await this.store.delete(id)
  }
}
