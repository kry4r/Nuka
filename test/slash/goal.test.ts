import { describe, expect, it } from 'vitest'
import { GoalCommand } from '../../src/slash/goal'
import { SessionManager } from '../../src/core/session/manager'
import type { SlashContext } from '../../src/slash/types'

function ctx(withSession = true): { ctx: SlashContext; sessions: SessionManager } {
  const sessions = new SessionManager()
  if (withSession) sessions.start({ providerId: 'p', model: 'm' })
  return {
    sessions,
    ctx: {
      sessions,
      providers: { getProviderConfig: () => undefined, listProviders: () => [] } as any,
      config: { providers: [], active: { providerId: 'p' } } as any,
    },
  }
}

describe('/goal', () => {
  it('sets an active goal from free-form text', async () => {
    const { ctx: c, sessions } = ctx()

    const res = await GoalCommand.run('ship the provider fixes', c)

    expect(res).toEqual({
      type: 'text',
      text: 'goal: active · ship the provider fixes',
    })
    expect(sessions.active()?.goal).toMatchObject({
      objective: 'ship the provider fixes',
      status: 'active',
    })
  })

  it('replaces prior goal metadata when setting a new objective', async () => {
    const { ctx: c, sessions } = ctx()
    sessions.setGoal(sessions.active()!.id, {
      objective: 'old goal',
      status: 'blocked',
      tokenBudget: 12000,
      tokenUsage: 3000,
      blockedReason: 'old blocker',
    })

    await GoalCommand.run('new goal', c)

    expect(sessions.active()?.goal).toMatchObject({
      objective: 'new goal',
      status: 'active',
    })
    expect(sessions.active()?.goal?.tokenBudget).toBeUndefined()
    expect(sessions.active()?.goal?.tokenUsage).toBeUndefined()
    expect(sessions.active()?.goal?.blockedReason).toBeUndefined()
  })

  it('shows the active goal when called without args', async () => {
    const { ctx: c, sessions } = ctx()
    sessions.setGoal(sessions.active()!.id, {
      objective: 'finish compact parity',
      tokenBudget: 12000,
      tokenUsage: 3000,
    })

    const res = await GoalCommand.run('', c)

    expect(res.type).toBe('text')
    if (res.type === 'text') {
      expect(res.text).toContain('goal: active · finish compact parity')
      expect(res.text).toContain('budget: 3.0k/12.0k tokens')
    }
  })

  it('updates goal status with pause/resume/complete/block', async () => {
    const { ctx: c, sessions } = ctx()
    sessions.setGoal(sessions.active()!.id, { objective: 'wire slash goal' })

    expect(await GoalCommand.run('pause', c)).toMatchObject({
      type: 'text',
      text: 'goal: paused · wire slash goal',
    })
    expect(sessions.active()?.goal?.status).toBe('paused')

    expect(await GoalCommand.run('resume', c)).toMatchObject({
      type: 'text',
      text: 'goal: active · wire slash goal',
    })
    expect(sessions.active()?.goal?.status).toBe('active')

    await GoalCommand.run('block waiting on review', c)
    expect(sessions.active()?.goal).toMatchObject({
      status: 'blocked',
      blockedReason: 'waiting on review',
    })

    await GoalCommand.run('resume', c)
    expect(sessions.active()?.goal).toMatchObject({
      status: 'active',
    })
    expect(sessions.active()?.goal?.blockedReason).toBeUndefined()

    await GoalCommand.run('block waiting on review', c)
    await GoalCommand.run('complete', c)
    expect(sessions.active()?.goal?.status).toBe('complete')
    expect(sessions.active()?.goal?.blockedReason).toBeUndefined()
  })

  it('clears the active goal', async () => {
    const { ctx: c, sessions } = ctx()
    sessions.setGoal(sessions.active()!.id, { objective: 'temporary goal' })

    const res = await GoalCommand.run('clear', c)

    expect(res).toEqual({ type: 'text', text: 'goal cleared: temporary goal' })
    expect(sessions.active()?.goal).toBeUndefined()
  })

  it('edits the current goal objective while preserving status and budget metadata', async () => {
    const { ctx: c, sessions } = ctx()
    sessions.setGoal(sessions.active()!.id, {
      objective: 'old objective',
      status: 'blocked',
      tokenBudget: 12000,
      tokenUsage: 3000,
      blockedReason: 'waiting on review',
    })

    const res = await GoalCommand.run('edit new objective', c)

    expect(res).toEqual({
      type: 'text',
      text: 'goal: blocked · new objective\nbudget: 3.0k/12.0k tokens\nblocked: waiting on review',
    })
    expect(sessions.active()?.goal).toMatchObject({
      objective: 'new objective',
      status: 'blocked',
      tokenBudget: 12000,
      tokenUsage: 3000,
      blockedReason: 'waiting on review',
    })
  })

  it('sets and clears a token budget through /goal budget', async () => {
    const { ctx: c, sessions } = ctx()
    sessions.setGoal(sessions.active()!.id, { objective: 'watch budget' })

    expect(await GoalCommand.run('budget 12500', c)).toEqual({
      type: 'text',
      text: 'goal: active · watch budget\nbudget: 0/12.5k tokens',
    })
    expect(sessions.active()?.goal?.tokenBudget).toBe(12500)

    expect(await GoalCommand.run('budget clear', c)).toEqual({
      type: 'text',
      text: 'goal: active · watch budget',
    })
    expect(sessions.active()?.goal?.tokenBudget).toBeUndefined()
  })

  it('accounts for current session token usage when showing goal budget', async () => {
    const { ctx: c, sessions } = ctx()
    const session = sessions.active()!
    session.totalUsage.inputTokens = 7000
    session.totalUsage.outputTokens = 6000
    sessions.setGoal(session.id, {
      objective: 'finish within budget',
      tokenBudget: 12000,
    })

    const res = await GoalCommand.run('', c)

    expect(res.type).toBe('text')
    if (res.type === 'text') {
      expect(res.text).toContain('goal: budget_limited · finish within budget')
      expect(res.text).toContain('budget: 13.0k/12.0k tokens')
    }
    expect(sessions.active()?.goal).toMatchObject({
      status: 'budget_limited',
      tokenUsage: 13000,
    })
  })

  it('returns a friendly message when there is no active session', async () => {
    const { ctx: c } = ctx(false)

    expect(await GoalCommand.run('ship it', c)).toEqual({
      type: 'text',
      text: 'No active session.',
    })
  })
})
