// src/slash/cost.ts
//
// Phase 7 §5.2 — `/cost` slash command.
//
// Three-row view: this session, today, all-time. Each row prints input/
// output/cache token counts and (when pricing is available) a USD figure.
// Falls back to the legacy provider-config based estimate when no
// CostTracker is wired (e.g. in older test contexts).

import type { SlashCommand, SlashContext } from './types'
import type { Aggregate, CostTracker } from '../core/cost/tracker'
import { computeCost } from '../core/session/telemetry'

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(n)
}

function row(label: string, agg: Aggregate, usd: number | undefined, padTo = 14): string {
  const left = label.padEnd(padTo, ' ')
  const cache = `${fmtTokens(agg.cacheReadTokens)}/${fmtTokens(agg.cacheCreateTokens)}`
  const tokens = `in: ${fmtTokens(agg.inputTokens)}   out: ${fmtTokens(agg.outputTokens)}   cache: ${cache}`
  const dollars = usd !== undefined ? `   $${usd.toFixed(4)}` : '   (no pricing)'
  return `${left}${tokens}${dollars}`
}

function renderTracker(tracker: CostTracker, sessionId: string, model: string): string {
  const cur = tracker.current(sessionId)
  const tod = tracker.today()
  const all = tracker.allTime()
  const lines = [
    row('This session', cur, tracker.toUsd(model, cur)),
    row('Today',        tod, tracker.toUsd(model, tod)),
    row('All-time',     all, tracker.toUsd(model, all)),
  ]
  return lines.join('\n')
}

export const CostCommand: SlashCommand = {
  name: 'cost',
  description: 'Show cost and token breakdown',
  run: async (_args: string, ctx: SlashContext) => {
    const s = ctx.sessions.active()
    if (!s) return { type: 'text', text: 'No active session.' }

    if (ctx.costTracker) {
      return { type: 'text', text: renderTracker(ctx.costTracker, s.id, s.model) }
    }

    // Legacy fallback path (used by tests that don't wire a tracker yet).
    const pc = ctx.providers.getProviderConfig(s.providerId)
    const cost = pc ? computeCost(pc, s.model, s.totalUsage) : 0
    const { inputTokens, outputTokens } = s.totalUsage
    const lines = [
      `provider   ${pc?.name ?? s.providerId}`,
      `model      ${s.model}`,
      `input      ${inputTokens.toLocaleString()} tokens`,
      `output     ${outputTokens.toLocaleString()} tokens`,
      `cost       $${cost.toFixed(4)}`,
    ]
    return { type: 'text', text: lines.join('\n') }
  },
}
