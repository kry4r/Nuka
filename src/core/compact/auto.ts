// src/core/compact/auto.ts
import type { Session } from '../session/types'
import type { LLMProvider } from '../provider/types'
import { compactSession } from './compact'

export type AutoCompactOpts = {
  provider: LLMProvider
  model: string
  keepTurns?: number
  autoThreshold: number
  contextWindow: number
}

export function shouldAutoCompact(session: Session, opts: AutoCompactOpts): boolean {
  const total = session.totalUsage.inputTokens + session.totalUsage.outputTokens
  return total > opts.contextWindow * opts.autoThreshold
}

export async function maybeAutoCompact(
  session: Session,
  opts: AutoCompactOpts,
): Promise<{ compacted: boolean; before: number; after: number }> {
  const before = session.totalUsage.inputTokens + session.totalUsage.outputTokens
  if (!shouldAutoCompact(session, opts)) return { compacted: false, before, after: before }
  await compactSession(session, { provider: opts.provider, model: opts.model, keepTurns: opts.keepTurns })
  // session.totalUsage is left unchanged intentionally — CostBar/StatusBar reads cumulative cost
  // from it and the next LLM call's inputTokens will reflect the shorter prompt automatically.
  const after = session.totalUsage.inputTokens + session.totalUsage.outputTokens
  return { compacted: true, before, after }
}
