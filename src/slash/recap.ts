// src/slash/recap.ts — Phase 14c §6.1
import { parseScope } from '../core/recap/parseScope'
import { buildRecap as defaultBuild } from '../core/recap/builder'
import { persistRecap as defaultPersist } from '../core/recap/persist'
import { renderMarkdown } from '../core/recap/renderMarkdown'
import { runForkedAgent, createCacheSafeParams } from '../core/agent/forkedAgent'
import type { SlashCommand, SlashContext, SlashResult } from './types'
import type { LLMProvider } from '../core/provider/types'

type ExtendedCtx = SlashContext & {
  _buildRecap?: typeof defaultBuild
  _persistRecap?: typeof defaultPersist
}

async function makeRunFork(ctx: SlashContext): Promise<(prompt: string) => Promise<{ text: string }>> {
  const session = ctx.sessions.active()
  if (!session) return async () => ({ text: '(no active session)' })

  const { provider } = ctx.providers.resolveFor(session)

  const params = createCacheSafeParams({
    parentSession: session,
    registry: { list: () => [] },
    systemPrompt: 'You produce concise recap suggestions.',
  })

  return async (prompt: string): Promise<{ text: string }> => {
    const r = await runForkedAgent({
      params,
      prompt,
      provider: provider as LLMProvider,
      signal: new AbortController().signal,
    })
    return { text: r.text }
  }
}

export const RecapCommand: SlashCommand = {
  name: 'recap',
  description: 'Generate a structured recap of the current session',
  usage: '/recap [--since 1h|30m|90s] [--agent <name>] [--pipeline <id>]',
  examples: ['/recap', '/recap --since 1h', '/recap --agent alice'],
  run: async (args: string, ctx: SlashContext): Promise<SlashResult> => {
    const extCtx = ctx as ExtendedCtx
    const session = ctx.sessions.active()
    if (!session) return { type: 'text', text: 'No active session.' }

    const scope = parseScope(args)

    // Collect events from bus if available — cast to any since SlashContext doesn't have bus
    const bus = (ctx as any).bus
    const events: Array<{ topic: string; payload: any; t?: number }> = []
    if (bus?.replay) {
      const topics = ['task', 'agent', 'message', 'harness'] as const
      for (const topic of topics) {
        const payloads: any[] = bus.replay(topic, 1024)
        for (const payload of payloads) {
          events.push({ topic, payload })
        }
      }
    }

    const build = extCtx._buildRecap ?? defaultBuild
    const persist = extCtx._persistRecap ?? defaultPersist

    const runFork = await makeRunFork(ctx)

    const doc = await build({
      sessionId: session.id,
      scope,
      events,
      session,
      runFork,
    })

    const md = renderMarkdown(doc)

    // Get home directory for persistence
    const home = (ctx as any).home ?? process.env['HOME'] ?? process.env['USERPROFILE'] ?? ''
    await persist(home, doc)

    return { type: 'text', text: md }
  },
}
