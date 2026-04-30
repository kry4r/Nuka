// src/core/recap/fields/tokens.ts — Phase 14c
// Rolls up agent.usage events into perAgent token counts.
// Uses the actual Nuka TokenUsage shape: inputTokens / outputTokens.
import type { RecapFields } from '../types'

type Rec = { topic: string; payload: any; t?: number }

export function reduceTokens(records: Rec[]): RecapFields['tokens'] {
  const perAgent: Record<string, { in: number; out: number }> = {}

  for (const r of records) {
    const p = r.payload
    if (r.topic !== 'agent') continue
    if (p.type !== 'agent.usage') continue

    const agentName: string = p.sessionId ?? 'unknown'
    const inputTokens: number  = p.inputTokens  ?? 0
    const outputTokens: number = p.outputTokens ?? 0

    if (!perAgent[agentName]) {
      perAgent[agentName] = { in: 0, out: 0 }
    }
    perAgent[agentName]!.in  += inputTokens
    perAgent[agentName]!.out += outputTokens
  }

  return { perAgent }
}
