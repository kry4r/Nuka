// src/tui/Welcome/feedConfigs.ts
//
// Phase B — Feed factory functions for the Welcome right rail.  Each
// helper adapts an existing data shape (UpdateEntry, RecentEntry, …) into
// a `FeedConfig` consumed by `FeedColumn`.

import type { FeedConfig, FeedLine } from './Feed'
import type { UpdateEntry } from '../../core/updates/load'
import type { RecentEntry } from '../../core/session/recent'

/** Format a unix-ms timestamp as a coarse "Nm/Nh/Nd/Nw ago" string. */
export function formatRelativeTimeAgo(ts: number, now: number = Date.now()): string {
  const diffMs = Math.max(0, now - ts)
  const sec = Math.floor(diffMs / 1000)
  if (sec < 60) return '<1m'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d`
  const wk = Math.floor(day / 7)
  return `${wk}w`
}

/**
 * Build the "Updates" feed from `~/.nuka/updates.json` entries.  Each
 * entry produces:
 *   - one bold version+title line (text only — bold formatting lives in Feed)
 *   - one bullet line per `bullets[]` entry, prefixed with "· "
 * Empty list → emptyMessage "(no updates)".
 */
export function createUpdatesFeed(updates: UpdateEntry[]): FeedConfig {
  const lines: FeedLine[] = []
  for (const e of updates) {
    const head = e.title
      ? (e.version ? `${e.version} \u2014 ${e.title}` : e.title)
      : (e.version ?? '')
    if (head) lines.push({ text: head })
    for (const b of e.bullets ?? []) {
      lines.push({ text: ` \u00b7 ${b}` })
    }
  }
  return {
    title: 'Updates',
    lines,
    emptyMessage: '(no updates)',
  }
}

/**
 * Build the "Recent" feed from persisted-session previews.  Each entry
 * becomes a line whose text is the prompt preview and whose timestamp is
 * the relative "Nh ago" form of `updatedAt`.
 * Footer "/resume for more" appears only when at least one entry exists.
 */
export function createRecentFeed(recent: RecentEntry[]): FeedConfig {
  const lines: FeedLine[] = recent.map(r => ({
    text: r.preview,
    timestamp: formatRelativeTimeAgo(r.updatedAt),
  }))
  return {
    title: 'Recent',
    lines,
    emptyMessage: '(no recent sessions)',
    footer: lines.length > 0 ? '/resume for more' : undefined,
  }
}
