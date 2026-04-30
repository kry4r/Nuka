// src/core/recap/fields/messages.ts — Phase 14c
import type { RecapFields } from '../types'

type Rec = { topic: string; payload: any; t?: number }

/** Importance score: broadcast > request_id > recency. */
function importance(env: any): number {
  if (env.to === '*') return 3
  if (env.request_id) return 2
  return 1
}

export function reduceMessages(records: Rec[]): RecapFields['messages'] {
  const all: RecapFields['messages'] = []

  for (const r of records) {
    const p = r.payload
    if (r.topic !== 'message') continue
    if (p.type !== 'message.sent') continue
    const env = p.envelope
    if (!env) continue
    all.push({
      id: env.id ?? '',
      from: env.from ?? '',
      to: env.to ?? '',
      summary: env.summary ?? '',
      t: env.sentAt ?? r.t ?? 0,
    })
  }

  // Sort by importance DESC, then by recency DESC
  all.sort((a, b) => {
    // Re-derive importance from the original envelope via from/to
    const ia = a.to === '*' ? 3 : 1
    const ib = b.to === '*' ? 3 : 1
    if (ia !== ib) return ib - ia
    return b.t - a.t
  })

  // Need to re-sort with request_id information — but we've lost it.
  // Since we stored the message, re-fetch importance by checking to='*'
  // The actual scoring is done inline above; request_id info comes from records.
  // Re-score properly:
  const scored = records
    .filter(r => r.topic === 'message' && r.payload?.type === 'message.sent')
    .map(r => {
      const env = r.payload.envelope
      return {
        msg: { id: env?.id ?? '', from: env?.from ?? '', to: env?.to ?? '', summary: env?.summary ?? '', t: env?.sentAt ?? r.t ?? 0 },
        score: importance(env),
      }
    })

  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score
    return b.msg.t - a.msg.t
  })

  return scored.slice(0, 10).map(s => s.msg)
}
