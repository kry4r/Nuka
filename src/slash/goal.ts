import type { SessionGoal } from '../core/session/types'
import type { SlashCommand, SlashContext } from './types'

function formatTokens(tokens: number): string {
  if (Math.abs(tokens) >= 1000) return `${(tokens / 1000).toFixed(1)}k`
  return String(tokens)
}

function formatGoal(goal: SessionGoal): string {
  const lines = [`goal: ${goal.status} · ${goal.objective}`]
  if (goal.tokenBudget !== undefined || goal.tokenUsage !== undefined) {
    const usage = formatTokens(goal.tokenUsage ?? 0)
    const budget = goal.tokenBudget !== undefined ? formatTokens(goal.tokenBudget) : '?'
    lines.push(`budget: ${usage}/${budget} tokens`)
  }
  if (goal.blockedReason) lines.push(`blocked: ${goal.blockedReason}`)
  return lines.join('\n')
}

function splitCommand(args: string): { sub: string; tail: string } {
  const trimmed = args.trim()
  const [sub = ''] = trimmed.split(/\s+/, 1)
  return {
    sub,
    tail: trimmed.slice(sub.length).trimStart(),
  }
}

async function runGoal(args: string, ctx: SlashContext) {
  const session = ctx.sessions.active()
  if (!session) return { type: 'text' as const, text: 'No active session.' }

  const trimmed = args.trim()
  if (trimmed.length === 0) {
    const goal = ctx.sessions.getGoal(session.id)
    return {
      type: 'text' as const,
      text: goal ? formatGoal(goal) : 'No active goal.',
    }
  }

  const { sub, tail } = splitCommand(trimmed)

  if (sub === 'clear') {
    const cleared = ctx.sessions.clearGoal(session.id)
    return {
      type: 'text' as const,
      text: cleared ? `goal cleared: ${cleared.objective}` : 'No active goal.',
    }
  }

  const current = ctx.sessions.getGoal(session.id)
  if (sub === 'pause' || sub === 'resume' || sub === 'complete' || sub === 'block') {
    if (!current) return { type: 'text' as const, text: 'No active goal.' }

    if (sub === 'block') {
      const goal = ctx.sessions.setGoal(session.id, {
        objective: current.objective,
        status: 'blocked',
        tokenBudget: current.tokenBudget,
        tokenUsage: current.tokenUsage,
        blockedReason: tail || 'blocked',
      })
      return { type: 'text' as const, text: formatGoal(goal) }
    }

    const goal = ctx.sessions.setGoal(session.id, {
      objective: current.objective,
      status: sub === 'pause' ? 'paused' : sub === 'complete' ? 'complete' : 'active',
      tokenBudget: current.tokenBudget,
      tokenUsage: current.tokenUsage,
      blockedReason: null,
    })
    return { type: 'text' as const, text: formatGoal(goal) }
  }

  const goal = ctx.sessions.setGoal(session.id, {
    objective: trimmed,
    status: 'active',
    tokenBudget: null,
    tokenUsage: null,
    blockedReason: null,
  })
  return { type: 'text' as const, text: formatGoal(goal) }
}

export const GoalCommand: SlashCommand = {
  name: 'goal',
  description: 'Set, inspect, and manage the active session goal',
  usage: '/goal [text|pause|resume|block <reason>|complete|clear]',
  examples: [
    '/goal finish provider fixes',
    '/goal pause',
    '/goal block waiting on review',
    '/goal complete',
  ],
  run: runGoal,
}
