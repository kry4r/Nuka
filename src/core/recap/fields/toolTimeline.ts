// src/core/recap/fields/toolTimeline.ts — Phase 14c
import type { RecapFields } from '../types'

type Rec = { topic: string; payload: any; t?: number }

type TimelineEntry = RecapFields['toolTimeline'][number]

export function reduceToolTimeline(records: Rec[]): RecapFields['toolTimeline'] {
  const out: TimelineEntry[] = []

  for (const r of records) {
    const p = r.payload
    if (r.topic !== 'agent') continue
    if (p.type !== 'agent.tool.start') continue

    const toolName: string = p.toolName ?? ''
    const sessionId: string = p.sessionId ?? ''
    const t = r.t ?? 0

    // Check if last entry is same tool + same session — if so, collapse
    const last = out[out.length - 1]
    if (last && last.toolName === toolName && last.sessionId === sessionId) {
      last.collapsedCount += 1
    } else {
      out.push({ t, toolName, collapsedCount: 1, sessionId })
    }
  }

  return out
}
