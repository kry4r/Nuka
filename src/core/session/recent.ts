// src/core/session/recent.ts
//
// Phase 13 M2 — Load recent sessions for the Welcome screen.
//
// Reads the top-N session metas from the persisted sessions store (sorted
// newest-first by updatedAt), then reads each session's messages to extract
// the first user message text. Returns entries stripped to 36 characters.
//
// Behaviour:
//   - Missing / unreadable sessions dir → []
//   - Malformed meta or messages → entry is skipped
//   - Never throws.

import { SessionStore } from './store'
import { sessionsDir } from './paths'

export type RecentEntry = {
  id: string
  /** First user message text, truncated to 36 chars */
  preview: string
  updatedAt: number
}

export const MAX_RECENT = 6
export const PREVIEW_LEN = 36

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + '\u2026' // '…'
}

/**
 * Load recent sessions from `~/.nuka/sessions/*.json`. Returns at most
 * `MAX_RECENT` entries, newest first. Returns `[]` on any error.
 * Never throws.
 */
export async function loadRecent(home: string): Promise<RecentEntry[]> {
  try {
    const store = new SessionStore({ dir: sessionsDir(home) })
    const metas = await store.list() // already sorted newest-first
    const top = metas.slice(0, MAX_RECENT)
    const results: RecentEntry[] = []

    for (const meta of top) {
      try {
        const messages = await store.readMessages(meta.id)
        // Find the first user message with text content
        let preview = ''
        for (const msg of messages) {
          if (msg.role !== 'user') continue
          // UserMessage.content is ContentBlock[]
          for (const block of msg.content) {
            if (block.type === 'text') {
              preview = block.text.trim()
              break
            }
          }
          if (preview) break
        }
        if (!preview) continue // skip sessions with no user messages
        results.push({
          id: meta.id,
          preview: truncate(preview, PREVIEW_LEN),
          updatedAt: meta.updatedAt,
        })
      } catch {
        // skip malformed session
      }
    }

    return results
  } catch {
    return []
  }
}
