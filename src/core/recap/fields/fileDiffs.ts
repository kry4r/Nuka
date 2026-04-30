// src/core/recap/fields/fileDiffs.ts — Phase 14c
import type { RecapFields } from '../types'

type Rec = { topic: string; payload: any; t?: number }

const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit'])

/** Estimate added/removed lines from Edit tool inputs or Write content. */
function estimateLines(input: any, toolName: string): { added: number; removed: number } {
  if (toolName === 'Edit') {
    const removed = ((input.old_string as string | undefined) ?? '').split('\n').length
    const added   = ((input.new_string as string | undefined) ?? '').split('\n').length
    return { added, removed }
  }
  if (toolName === 'Write') {
    const added = ((input.content as string | undefined) ?? '').split('\n').length
    return { added, removed: 0 }
  }
  return { added: 0, removed: 0 }
}

export function reduceFileDiffs(records: Rec[]): RecapFields['fileDiffs'] {
  // Map from filePath → { agentName, added, removed }
  const byPath = new Map<string, { agentName: string; added: number; removed: number }>()

  for (const r of records) {
    const p = r.payload
    if (r.topic !== 'agent') continue
    if (p.type !== 'agent.tool.start') continue
    if (!WRITE_TOOLS.has(p.toolName)) continue

    const filePath: string = (p.input as any)?.file_path ?? ''
    if (!filePath) continue

    const { added, removed } = estimateLines(p.input, p.toolName)
    const existing = byPath.get(filePath)
    if (existing) {
      existing.added   += added
      existing.removed += removed
    } else {
      byPath.set(filePath, { agentName: p.sessionId ?? 'unknown', added, removed })
    }
  }

  return [...byPath.entries()].map(([path, v]) => ({
    agentName: v.agentName,
    path,
    added: v.added,
    removed: v.removed,
  }))
}
