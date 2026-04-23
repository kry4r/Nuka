import { describe, it, expect, vi } from 'vitest'
import { ExitCommand } from '../../src/slash/exit'
import { HelpCommand } from '../../src/slash/help'
import { ClearCommand } from '../../src/slash/clear'
import { NewCommand } from '../../src/slash/new'
import { BranchCommand } from '../../src/slash/branch'
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

  it('/branch returns branch-session effect', async () => {
    expect(await BranchCommand.run('', ctx())).toEqual({ type: 'effect', effect: { kind: 'branch-session' } })
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
})
