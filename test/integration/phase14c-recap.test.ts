import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { buildRecap } from '../../src/core/recap/builder'
import { renderMarkdown } from '../../src/core/recap/renderMarkdown'
import { persistRecap } from '../../src/core/recap/persist'
import { ensureNukaLayout } from '../../src/core/paths'

describe('phase14c recap e2e', () => {
  let home: string
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-14c-'))
    ensureNukaLayout(home)
  })

  it('synthetic events → buildRecap → markdown → persisted', async () => {
    const events = [
      {
        topic: 'task' as const,
        payload: { type: 'task.created', task: { id: 't1', description: 'do x', startedAt: 1000, agentName: 'alice' } as any },
        t: 1000,
      },
      {
        topic: 'task' as const,
        payload: { type: 'task.state', id: 't1', from: 'running', to: 'completed' } as any,
        t: 4000,
      },
      {
        topic: 'message' as const,
        payload: {
          type: 'message.sent',
          envelope: { id: 'm1', from: 'lead', to: 'team:demo/alice', summary: 'kickoff', message: 'go', sentAt: 500 },
        },
      },
    ]

    const doc = await buildRecap({
      sessionId: 's1',
      scope: { kind: 'full' },
      events,
      session: { messages: [] } as any,
      runFork: async () => ({ text: 'next: review tests' }),
    })

    expect(doc.fields.completed.length).toBe(1)
    expect(doc.fields.messages.length).toBe(1)

    const md = renderMarkdown(doc)
    expect(md).toContain('alice')
    expect(md).toContain('kickoff')

    const file = await persistRecap(home, doc)
    expect(fs.existsSync(file)).toBe(true)
    const content = fs.readFileSync(file, 'utf8')
    expect(content).toContain('## ✅ Completed')
  })

  it('tokens reducer works end-to-end', async () => {
    const events = [
      { topic: 'agent' as const, t: 1000, payload: { type: 'agent.usage', sessionId: 'alice', inputTokens: 500, outputTokens: 200 } },
      { topic: 'agent' as const, t: 2000, payload: { type: 'agent.usage', sessionId: 'bob', inputTokens: 300, outputTokens: 100 } },
    ]
    const doc = await buildRecap({
      sessionId: 's2',
      scope: { kind: 'full' },
      events,
      session: { messages: [] } as any,
      runFork: async () => ({ text: 'check performance' }),
    })
    expect(doc.fields.tokens.perAgent['alice']).toEqual({ in: 500, out: 200 })
    expect(doc.fields.tokens.perAgent['bob']).toEqual({ in: 300, out: 100 })
    const md = renderMarkdown(doc)
    expect(md).toContain('alice: 500 in / 200 out')
  })

  it('scope filter is preserved in doc', async () => {
    const doc = await buildRecap({
      sessionId: 's3',
      scope: { kind: 'since', ms: 1800_000 },
      events: [],
      session: { messages: [] } as any,
      runFork: async () => ({ text: 'run more tests' }),
    })
    expect(doc.scope).toEqual({ kind: 'since', ms: 1800_000 })
  })
})
