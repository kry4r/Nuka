// src/core/recap/fields/completed.ts — Phase 14c
import type { RecapFields } from '../types'

type Rec = { topic: string; payload: any; t?: number }

export function reduceCompleted(records: Rec[]): RecapFields['completed'] {
  const created = new Map<string, { description: string; startedAt: number; agentName?: string }>()
  const out: RecapFields['completed'] = []
  for (const r of records) {
    const p = r.payload
    if (r.topic === 'task' && p.type === 'task.created') {
      created.set(p.task.id, {
        description: p.task.description,
        startedAt: p.task.startedAt ?? 0,
        agentName: p.task.agentName,
      })
    } else if (r.topic === 'task' && p.type === 'task.state' && p.to === 'completed') {
      const c = created.get(p.id)
      out.push({
        id: p.id,
        description: c?.description ?? '(unknown)',
        durationMs: (r.t ?? 0) - (c?.startedAt ?? 0),
        agentName: c?.agentName,
      })
    }
  }
  return out
}
