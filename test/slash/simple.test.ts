import { describe, it, expect, vi } from 'vitest'
import { ExitCommand } from '../../src/slash/exit'
import { HelpCommand } from '../../src/slash/help'
import { ClearCommand } from '../../src/slash/clear'
import { NewCommand } from '../../src/slash/new'
import { ForkCommand } from '../../src/slash/fork'
import { BtwCommand } from '../../src/slash/btw'
import { CostCommand } from '../../src/slash/cost'
import { SessionManager } from '../../src/core/session/manager'
import type { SlashContext } from '../../src/slash/types'

function ctx(overrides: Partial<SlashContext> = {}): SlashContext {
  const sessions = new SessionManager()
  sessions.start({ providerId: 'p', model: 'm' })
  return {
    sessions,
    providers: { getProviderConfig: () => undefined, listProviders: () => [] } as any,
    config: { providers: [], active: { providerId: 'p' } } as any,
    ...overrides,
  }
}

describe('simple slash commands', () => {
  it('/exit returns { type: exit }', async () => {
    expect(await ExitCommand.run('', ctx())).toEqual({ type: 'exit' })
  })

  it('/help returns text listing commands', async () => {
    const c = ctx()
    const res = await HelpCommand.run('', c)
    expect(res.type).toBe('text')
    if (res.type === 'text') expect(res.text).toMatch(/exit/)
  })

  it('/clear returns clear-screen effect', async () => {
    expect(await ClearCommand.run('', ctx())).toEqual({ type: 'effect', effect: { kind: 'clear-screen' } })
  })

  it('/new returns new-session effect', async () => {
    expect(await NewCommand.run('', ctx())).toEqual({ type: 'effect', effect: { kind: 'new-session' } })
  })

  it('/fork returns fork-session effect', async () => {
    expect(await ForkCommand.run('', ctx())).toEqual({ type: 'effect', effect: { kind: 'fork-session' } })
  })

  it('/btw enqueues text into the active session', async () => {
    const c = ctx()
    const res = await BtwCommand.run('hello', c)
    expect(res.type).toBe('text')
    expect(c.sessions.active()?.queue.size()).toBe(1)
  })

  it('/cost renders a breakdown of totals and per-model usage', async () => {
    const c = ctx()
    const active = c.sessions.active()!
    active.totalUsage = { inputTokens: 1000, outputTokens: 2000 }
    const res = await CostCommand.run('', c)
    expect(res.type).toBe('text')
    if (res.type === 'text') {
      expect(res.text).toMatch(/tokens/i)
    }
  })

  it('/cost reads from CostTracker when present and shows $-figure for known models', async () => {
    const { CostTracker } = await import('../../src/core/cost/tracker')
    const tracker = new CostTracker()
    const sessions = new SessionManager()
    const s = sessions.start({ providerId: 'p', model: 'claude-haiku-4-5' })
    tracker.record('claude-haiku-4-5', s.id, { input: 100_000, output: 50_000 })
    const c = ctx({ sessions, costTracker: tracker })
    const res = await CostCommand.run('', c)
    expect(res.type).toBe('text')
    if (res.type === 'text') {
      expect(res.text).toContain('This session')
      expect(res.text).toContain('Today')
      expect(res.text).toContain('All-time')
      // Known model -> a USD figure must appear.
      expect(res.text).toMatch(/\$\d+\.\d{4}/)
    }
  })

  it('/cost falls back to "(no pricing)" for unknown models', async () => {
    const { CostTracker } = await import('../../src/core/cost/tracker')
    const tracker = new CostTracker()
    const sessions = new SessionManager()
    const s = sessions.start({ providerId: 'p', model: 'mystery-model' })
    tracker.record('mystery-model', s.id, { input: 100, output: 50 })
    const c = ctx({ sessions, costTracker: tracker })
    const res = await CostCommand.run('', c)
    expect(res.type).toBe('text')
    if (res.type === 'text') {
      expect(res.text).toContain('(no pricing)')
    }
  })
})
