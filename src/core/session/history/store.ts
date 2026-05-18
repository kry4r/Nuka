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
