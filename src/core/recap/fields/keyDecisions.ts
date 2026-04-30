// src/core/recap/fields/keyDecisions.ts — Phase 14c
// Extracts [brainstorm] / [plan] / [handoff] directives from harness events.
import type { RecapFields } from '../types'

type Rec = { topic: string; payload: any; t?: number }
type DecisionSource = RecapFields['keyDecisions'][number]['source']

const TAG_RE = /^\[(brainstorm|plan|handoff)\]\s*(.+)$/i

export function reduceKeyDecisions(records: Rec[]): RecapFields['keyDecisions'] {
  const out: RecapFields['keyDecisions'] = []

  for (const r of records) {
    const p = r.payload
    if (r.topic !== 'harness') continue
    if (p.type !== 'harness.editor.directive') continue

    const directive: string = p.directive ?? ''
    const m = directive.match(TAG_RE)
    if (!m) continue

    out.push({
      source: m[1]!.toLowerCase() as DecisionSource,
      text: m[2]!.trim(),
      t: r.t ?? 0,
    })
  }

  return out
}
