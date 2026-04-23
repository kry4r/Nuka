import type { SlashCommand, SlashContext } from './types'
import { computeCost } from '../core/session/telemetry'

export const CostCommand: SlashCommand = {
  name: 'cost',
  description: 'Show cost and token breakdown',
  run: async (_args: string, ctx: SlashContext) => {
    const s = ctx.sessions.active()
    if (!s) return { type: 'text', text: 'No active session.' }
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
