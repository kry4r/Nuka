// src/core/recap/fields/inFlight.ts — Phase 14c
import type { RecapFields } from '../types'

type Rec = { topic: string; payload: any; t?: number }
const TERMINAL = new Set(['completed', 'failed', 'killed'])

export function reduceInFlight(records: Rec[]): RecapFields['inFlight'] {
  const created = new Map<string, { description: string; state: string }>()
  const terminal = new Set<string>()

  for (const r of records) {
    const p = r.payload
    if (r.topic === 'task' && p.type === 'task.created') {
      created.set(p.task.id, { description: p.task.description ?? '', state: p.task.state ?? 'running' })
    } else if (r.topic === 'task' && p.type === 'task.state') {
      // Update current state
      const entry = created.get(p.id)
      if (entry) entry.state = p.to
      if (TERMINAL.has(p.to)) terminal.add(p.id)
    }
  }

  const out: RecapFields['inFlight'] = []
  for (const [id, { description, state }] of created) {
    if (!terminal.has(id)) {
      out.push({ id, state, description })
    }
  }
  return out
}
