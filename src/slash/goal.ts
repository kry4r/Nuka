import type { SessionGoal } from '../core/session/types'
import type { Session } from '../core/session/types'
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

function totalTokens(session: Session): number {
  return session.totalUsage.inputTokens + session.totalUsage.outputTokens
}

function usageAwareGoal(ctx: SlashContext, session: Session, goal: SessionGoal | null): SessionGoal | null {
  if (!goal) return null
  if (goal.tokenBudget === undefined && goal.tokenUsage === undefined) return goal

  const tokenUsage = Math.max(goal.tokenUsage ?? 0, totalTokens(session))
  const shouldLimit =
    goal.tokenBudget !== undefined &&
    tokenUsage > goal.tokenBudget &&
    (goal.status === 'active' || goal.status === 'budget_limited')
  if (tokenUsage === goal.tokenUsage && (!shouldLimit || goal.status === 'budget_limited')) {
    return goal
  }

  return ctx.sessions.setGoal(session.id, {
    objective: goal.objective,
    status: shouldLimit ? 'budget_limited' : goal.status,
    tokenBudget: goal.tokenBudget,
    tokenUsage,
    blockedReason: goal.blockedReason,
  })
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
    const goal = usageAwareGoal(ctx, session, ctx.sessions.getGoal(session.id))
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
  const currentWithUsage = usageAwareGoal(ctx, session, current)
  if (sub === 'edit') {
    if (!currentWithUsage) return { type: 'text' as const, text: 'No active goal.' }
    if (!tail) return { type: 'text' as const, text: 'Usage: /goal edit <new objective>' }

    const goal = ctx.sessions.setGoal(session.id, {
      objective: tail,
      status: currentWithUsage.status,
      tokenBudget: currentWithUsage.tokenBudget,
      tokenUsage: currentWithUsage.tokenUsage,
      blockedReason: currentWithUsage.blockedReason,
    })
    return { type: 'text' as const, text: formatGoal(goal) }
  }

  if (sub === 'budget') {
    if (!currentWithUsage) return { type: 'text' as const, text: 'No active goal.' }
    if (tail === 'clear') {
      const goal = ctx.sessions.setGoal(session.id, {
        objective: currentWithUsage.objective,
        status: currentWithUsage.status === 'budget_limited' ? 'active' : currentWithUsage.status,
        tokenBudget: null,
        tokenUsage: null,
        blockedReason: currentWithUsage.blockedReason,
      })
      return { type: 'text' as const, text: formatGoal(goal) }
    }

    const tokenBudget = Number(tail)
    if (!Number.isFinite(tokenBudget) || tokenBudget <= 0) {
      return { type: 'text' as const, text: 'Usage: /goal budget <tokens|clear>' }
    }
    const tokenUsage = totalTokens(session)
    const goal = ctx.sessions.setGoal(session.id, {
      objective: currentWithUsage.objective,
      status: tokenUsage > tokenBudget && currentWithUsage.status === 'active'
        ? 'budget_limited'
        : currentWithUsage.status,
      tokenBudget: Math.floor(tokenBudget),
      tokenUsage,
      blockedReason: currentWithUsage.blockedReason,
    })
    return { type: 'text' as const, text: formatGoal(goal) }
  }

  if (sub === 'pause' || sub === 'resume' || sub === 'complete' || sub === 'block') {
    if (!currentWithUsage) return { type: 'text' as const, text: 'No active goal.' }

    if (sub === 'block') {
      const goal = ctx.sessions.setGoal(session.id, {
        objective: currentWithUsage.objective,
        status: 'blocked',
        tokenBudget: currentWithUsage.tokenBudget,
        tokenUsage: currentWithUsage.tokenUsage,
        blockedReason: tail || 'blocked',
      })
      return { type: 'text' as const, text: formatGoal(goal) }
    }

    const goal = ctx.sessions.setGoal(session.id, {
      objective: currentWithUsage.objective,
      status: sub === 'pause' ? 'paused' : sub === 'complete' ? 'complete' : 'active',
      tokenBudget: currentWithUsage.tokenBudget,
      tokenUsage: currentWithUsage.tokenUsage,
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
  usage: '/goal [text|edit <text>|budget <tokens|clear>|pause|resume|block <reason>|complete|clear]',
  examples: [
    '/goal finish provider fixes',
    '/goal edit finish compact parity',
    '/goal budget 120000',
    '/goal pause',
    '/goal block waiting on review',
    '/goal complete',
  ],
  run: runGoal,
}
