// test/slash/rewind.test.ts
import { describe, it, expect } from 'vitest'
import { RewindCommand, recentAssistantMessages, firstLinePreview } from '../../src/slash/rewind'
import { SessionManager } from '../../src/core/session/manager'
import type { SlashContext } from '../../src/slash/types'
import type { AssistantMessage, Message } from '../../src/core/message/types'

function ctx(): { ctx: SlashContext; sessions: SessionManager } {
  const sessions = new SessionManager()
  sessions.start({ providerId: 'p', model: 'm' })
  return {
    sessions,
    ctx: {
      sessions,
      providers: { getProviderConfig: () => undefined, listProviders: () => [] } as any,
      config: { providers: [], active: { providerId: 'p' } } as any,
    },
  }
}

function a(id: string, text: string): AssistantMessage {
  return { role: 'assistant', id, ts: 0, content: [{ type: 'text', text }] }
}

describe('recentAssistantMessages / firstLinePreview', () => {
  it('returns assistant-only messages newest first, up to n', () => {
    const msgs: Message[] = [
      a('a1', 'one'),
      { role: 'user', id: 'u1', ts: 0, content: [{ type: 'text', text: 'q' }] },
      a('a2', 'two'),
      a('a3', 'three'),
    ]
    const r = recentAssistantMessages(msgs, 2)
    expect(r.map(m => m.id)).toEqual(['a3', 'a2'])
  })

  it('preview is trimmed and truncated', () => {
    const long = a('x', '  ' + 'x'.repeat(200))
    const p = firstLinePreview(long, 20)
    expect(p.endsWith('…')).toBe(true)
    expect(p.length).toBe(20)
  })

  it('preview falls back to tool_use label when no text block', () => {
    const m: AssistantMessage = { role: 'assistant', id: 'a', ts: 0, content: [{ type: 'tool_use', id: 't', name: 'Bash', input: {} }] }
    expect(firstLinePreview(m)).toBe('[tool_use Bash]')
  })
})

describe('/rewind', () => {
  it('no args → lists last 10 assistant messages', async () => {
    const { ctx: c, sessions } = ctx()
    sessions.active()!.messages.push(a('a1', 'first'), a('a2', 'second'))
    const res = await RewindCommand.run('', c)
    expect(res.type).toBe('text')
    if (res.type === 'text') {
      expect(res.text).toContain('1. second')
      expect(res.text).toContain('2. first')
    }
  })

  it('empty transcript → friendly message', async () => {
    const { ctx: c } = ctx()
    const res = await RewindCommand.run('', c)
    expect(res.type).toBe('text')
    if (res.type === 'text') expect(res.text).toContain('No assistant messages')
  })

  it('`/rewind 1` truncates at the newest assistant message', async () => {
    const { ctx: c, sessions } = ctx()
    const s = sessions.active()!
    s.messages.push(a('a1', 'first'), a('a2', 'second'))
    const res = await RewindCommand.run('1', c)
    expect(res.type).toBe('text')
    expect(s.messages.map(m => (m as any).id)).toEqual(['a1'])
  })

  it('invalid index → error text, no mutation', async () => {
    const { ctx: c, sessions } = ctx()
    const s = sessions.active()!
    s.messages.push(a('a1', 'first'))
    const res = await RewindCommand.run('5', c)
    expect(res.type).toBe('text')
    if (res.type === 'text') expect(res.text).toMatch(/Invalid index/)
    expect(s.messages).toHaveLength(1)
  })
})
