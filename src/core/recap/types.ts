// src/core/recap/types.ts — Phase 14c §5.1

export type RecapScope =
  | { kind: 'full' }
  | { kind: 'since'; ms: number }
  | { kind: 'agent'; name: string }
  | { kind: 'pipeline'; id: string }

export type RecapFields = {
  completed: Array<{ id: string; description: string; durationMs: number; agentName?: string }>
  inFlight:  Array<{ id: string; state: string; description: string }>
  fileDiffs: Array<{ agentName: string; path: string; added: number; removed: number }>
  toolTimeline: Array<{ t: number; toolName: string; collapsedCount: number; sessionId: string }>
  messages:  Array<{ id: string; from: string; to: string; summary: string; t: number }>
  pipelines: Array<{ pipelineId: string; nodes: Array<{ id: string; status: string; agent: string }> }>
  tokens:    { perAgent: Record<string, { in: number; out: number }>; cost?: number }
  nextStep:  string
  keyDecisions: Array<{ source: 'brainstorm' | 'plan' | 'handoff'; text: string; t: number }>
}

export type RecapDoc = {
  session: string
  generatedAt: number
  scope: RecapScope
  fields: RecapFields
}

export type AwaySummaryCard = {
  generatedAt: number
  text: string
  inputTokensUsed: number
  modelUsed: string
}
