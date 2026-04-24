// test/slash/session-commands.test.ts
import { describe, it, expect } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SessionManager } from '../../src/core/session/manager'
import { SessionStore, DebouncedMetaWriter } from '../../src/core/session/store'
import { ResumeCommand } from '../../src/slash/resume'
import { HistoryCommand } from '../../src/slash/history'
import { DeleteSessionCommand } from '../../src/slash/delete-session'
import type { SlashContext } from '../../src/slash/types'

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'nuka-slash-test-'))
}

function makeCtx(sessions: SessionManager): SlashContext {
  return {
    sessions,
    providers: { getProviderConfig: () => undefined, listProviders: () => [] } as any,
    config: { providers: [], active: { providerId: 'p' } } as any,
  }
}

describe('/resume', () => {
  it('returns a session-picker dialog descriptor', async () => {
    const m = new SessionManager()
    const res = await ResumeCommand.run('', makeCtx(m))
    expect(res).toEqual({ type: 'dialog', dialog: { kind: 'session-picker' } })
  })
})

describe('/history', () => {
  it('returns "No past sessions." when nothing stored', async () => {
    const m = new SessionManager()
    const res = await HistoryCommand.run('', makeCtx(m))
    expect(res).toEqual({ type: 'text', text: 'No past sessions.' })
  })

  it('lists stored sessions with id prefix, date, model, and msg count', async () => {
    const dir = await tmpDir()
    const store = new SessionStore({ dir })
    const meta = new DebouncedMetaWriter(store, 0)
    const m = new SessionManager({ store, metaWriter: meta })
    const s = m.start({ providerId: 'p', model: 'claude-sonnet-4-6' })
    await meta.flush()

    const res = await HistoryCommand.run('', makeCtx(m))
    expect(res.type).toBe('text')
    if (res.type === 'text') {
      expect(res.text).toContain(s.id.slice(0, 8))
      expect(res.text).toContain('claude-sonnet-4-6')
      expect(res.text).toContain('msgs=')
    }
  })
})

describe('/delete-session', () => {
  it('returns usage hint when no args', async () => {
    const m = new SessionManager()
    const res = await DeleteSessionCommand.run('', makeCtx(m))
    expect(res).toEqual({ type: 'text', text: 'usage: /delete-session <id>' })
  })

  it('returns "No matching session." for unknown prefix', async () => {
    const m = new SessionManager()
    const res = await DeleteSessionCommand.run('XXXXXXXX', makeCtx(m))
    expect(res).toEqual({ type: 'text', text: 'No matching session.' })
  })

  it('deletes a session by unique prefix and returns confirmation', async () => {
    const dir = await tmpDir()
    const store = new SessionStore({ dir })
    const meta = new DebouncedMetaWriter(store, 0)
    const m = new SessionManager({ store, metaWriter: meta })
    const s = m.start({ providerId: 'p', model: 'm' })
    await meta.flush()

    const prefix = s.id.slice(0, 8)
    const res = await DeleteSessionCommand.run(prefix, makeCtx(m))
    expect(res.type).toBe('text')
    if (res.type === 'text') {
      expect(res.text).toContain('deleted session')
      expect(res.text).toContain(prefix)
    }

    // confirm it's gone from persisted list
    const remaining = await m.listPersisted()
    expect(remaining.find(x => x.id === s.id)).toBeUndefined()
  })

  it('returns ambiguous message when prefix matches multiple sessions', async () => {
    const dir = await tmpDir()
    const store = new SessionStore({ dir })
    const m = new SessionManager({ store })

    // Write two meta files with IDs that share a common prefix
    const fakeId1 = 'AAAA0000BBBBCCCC0011223344'
    const fakeId2 = 'AAAA1111BBBBCCCC0011223344'
    const baseMeta = {
      parentId: undefined,
      providerId: 'p',
      model: 'm',
      messageCount: 0,
      totalUsage: { inputTokens: 0, outputTokens: 0 },
      mode: 'normal' as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    // Write directly to disk by using the internal path pattern
    const fs2 = await import('node:fs/promises')
    await fs2.mkdir(dir, { recursive: true })
    await fs2.writeFile(
      path.join(dir, `${fakeId1}.meta.json`),
      JSON.stringify({ id: fakeId1, ...baseMeta }),
      'utf8',
    )
    await fs2.writeFile(
      path.join(dir, `${fakeId2}.meta.json`),
      JSON.stringify({ id: fakeId2, ...baseMeta }),
      'utf8',
    )

    const res = await DeleteSessionCommand.run('AAAA', makeCtx(m))
    expect(res.type).toBe('text')
    if (res.type === 'text') {
      expect(res.text).toMatch(/Ambiguous/)
    }
  })
})
