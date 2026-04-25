// test/core/memdir/integration.test.ts
//
// End-to-end coverage for Phase 7 §5.3:
//   1. After a multi-turn session, synth → appendMemory grows MEMORY.md.
//   2. The next runAgent's system prompt contains a `## Memory` section
//      with the synthesized body.
//   3. /memdir clear empties the file; /memdir list enumerates it.

import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runAgent } from '../../../src/core/agent/loop'
import { createSession } from '../../../src/core/session/session'
import { ToolRegistry } from '../../../src/core/tools/registry'
import { PermissionChecker } from '../../../src/core/permission/checker'
import { buildSystemPrompt } from '../../../src/core/agent/systemPrompt'
import {
  appendMemory,
  loadMemory,
  clearMemory,
  memoryPath,
} from '../../../src/core/memdir/index'
import { synthMemoryEntry } from '../../../src/core/memdir/synth'
import { findRelevant, tokenize } from '../../../src/core/memdir/relevance'
import { MemdirCommand, setMemdirSynthCallable } from '../../../src/slash/memdir'
import type { LLMProvider, ProviderEvent } from '../../../src/core/provider/types'
import type { SlashContext } from '../../../src/slash/types'
import { SessionManager } from '../../../src/core/session/manager'

async function tmpHome(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'nuka-memdir-int-'))
}

function mockProvider(text: string): LLMProvider {
  return {
    id: 'mock', format: 'openai',
    async *stream(): AsyncIterable<ProviderEvent> {
      yield { type: 'text_delta', text }
      yield { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 10, outputTokens: 5 } }
    },
    async listRemoteModels() { return [] },
  } as LLMProvider
}

describe('memdir integration', () => {
  it('full cycle: run agent, synth from transcript, append, find on next turn', async () => {
    const home = await tmpHome()
    const cwd = '/proj/integration'

    // 1. Run a tiny agent session — gives us a non-empty transcript.
    const session = createSession({ providerId: 'p', model: 'claude-haiku-4-5' })
    const echoProvider = mockProvider('User wants bcrypt comparison in src/auth/login.ts')
    const tools = new ToolRegistry()
    const permission = new PermissionChecker(() => session.permissionCache, async () => ({ allowed: true }))
    for await (const _ of runAgent(
      { text: 'tell me about auth' },
      session,
      { provider: { resolveFor: () => ({ provider: echoProvider, model: 'claude-haiku-4-5' }) } as any, tools, permission },
      new AbortController().signal,
    )) void _
    expect(session.messages.length).toBeGreaterThanOrEqual(2)

    // 2. Synth from the session transcript with a mock provider that
    //    returns a well-formed extraction.
    const synthOutput = '---\nkeywords: [auth, bcrypt, login]\nscore: 0.8\n---\n\nUser prefers constant-time bcrypt.compare in src/auth/login.ts.'
    const synthProvider = mockProvider(synthOutput)
    const entry = await synthMemoryEntry(session.messages, synthProvider, 'm', session.id)
    expect(entry).not.toBeNull()
    expect(entry!.keywords).toContain('bcrypt')

    // 3. Append → MEMORY.md grows by 1.
    const before = await loadMemory(cwd, home)
    await appendMemory(cwd, entry!, home)
    const after = await loadMemory(cwd, home)
    expect(after.length).toBe(before.length + 1)

    // Verify the file actually exists at the expected path.
    const stat = await fs.stat(memoryPath(cwd, home))
    expect(stat.isFile()).toBe(true)

    // 4. Next runAgent's systemPrompt includes `## Memory` with the entry.
    const memory = findRelevant(after, tokenize('please review the bcrypt login flow'), 5)
    expect(memory.length).toBeGreaterThanOrEqual(1)
    const sys = buildSystemPrompt({
      cwd, platform: 'linux', shell: '/bin/sh', nodeVersion: process.version,
      gitBranch: null,
      memory,
    })
    expect(sys).toMatch(/## Memory/)
    expect(sys).toMatch(/bcrypt/)
  })

  it('builds no Memory section when the relevance filter yields []', () => {
    const sys = buildSystemPrompt({
      cwd: '/x', platform: 'linux', shell: '/bin/sh', nodeVersion: 'v20',
      gitBranch: null,
      memory: [],
    })
    expect(sys).not.toMatch(/## Memory/)
  })

  it('/memdir list / clear / compact slash command', async () => {
    const home = await tmpHome()
    // Use process.cwd() since MemdirCommand resolves cwd internally.
    // Override HOME just for this test so memdir paths land in tmp.
    const origHome = process.env.HOME
    process.env.HOME = home
    try {
      const ctx = (): SlashContext => ({
        sessions: new SessionManager(),
        providers: { getProviderConfig: () => undefined } as any,
        config: {} as any,
      })

      // list — empty
      let res = await MemdirCommand.run('list', ctx())
      expect(res.type).toBe('text')
      if (res.type === 'text') expect(res.text).toContain('memory empty')

      // append something then list
      await appendMemory(process.cwd(), {
        ts: '2026-04-25T00:00:00Z',
        sessionId: 's',
        keywords: ['kw'],
        body: 'a fact',
      })
      res = await MemdirCommand.run('list', ctx())
      if (res.type === 'text') expect(res.text).toContain('a fact')

      // compact without callable → graceful message
      setMemdirSynthCallable(undefined)
      res = await MemdirCommand.run('compact', ctx())
      if (res.type === 'text') expect(res.text).toMatch(/compact unavailable/)

      // compact with callable → reports the appended body
      setMemdirSynthCallable(async () => ({
        ts: '2026-04-25T00:00:01Z',
        sessionId: 's2',
        keywords: ['x'],
        body: 'synthesized fact',
      }))
      res = await MemdirCommand.run('compact', ctx())
      if (res.type === 'text') expect(res.text).toContain('synthesized fact')

      // clear
      res = await MemdirCommand.run('clear', ctx())
      if (res.type === 'text') expect(res.text).toContain('cleared')
      const after = await loadMemory(process.cwd())
      expect(after).toEqual([])
    } finally {
      // Always undo HOME change + leave callable cleared so other tests
      // don't see leftover state.
      if (origHome === undefined) delete process.env['HOME']
      else process.env['HOME'] = origHome
      setMemdirSynthCallable(undefined)
      // best-effort cleanup of anything we wrote
      await clearMemory(process.cwd(), home).catch(() => {})
    }
  })
})
