// src/tui/Monitor/rollupTokens.ts
export type AgentTokenRollup = { inputTokens: number; outputTokens: number }

export function rollupTokens(events: Array<{ agentName: string; inputTokens: number; outputTokens: number }>): Record<string, AgentTokenRollup> {
  const out: Record<string, AgentTokenRollup> = {}
  for (const e of events) {
    if (!out[e.agentName]) out[e.agentName] = { inputTokens: 0, outputTokens: 0 }
    out[e.agentName]!.inputTokens = e.inputTokens                        // latest wins
    out[e.agentName]!.outputTokens += e.outputTokens                     // sum
  }
  return out
}
