// test/core/memdir/relevance.test.ts
import { describe, it, expect } from 'vitest'
import { tokenize, findRelevant } from '../../../src/core/memdir/relevance'
import type { MemoryEntry } from '../../../src/core/memdir/parser'
import { synthMemoryEntry } from '../../../src/core/memdir/synth'
import type { LLMProvider, ProviderEvent } from '../../../src/core/provider/types'

const E = (over: Partial<MemoryEntry>): MemoryEntry => ({
  ts: '2026-04-25T00:00:00Z',
  sessionId: 's',
  keywords: [],
  body: '',
  ...over,
})

describe('memdir relevance: tokenize', () => {
  it('lower-cases and drops short tokens / stopwords', () => {
    const t = tokenize('The Quick Brown Fox jumps over the lazy DOG')
    expect(t).toContain('quick')
    expect(t).toContain('brown')
    expect(t).toContain('jumps')
    expect(t).not.toContain('the')
    expect(t).not.toContain('a')
  })

  it('treats hyphens and slashes as separators', () => {
    const t = tokenize('src/auth/login.ts uses bcrypt-compare')
    expect(t).toContain('login')
    expect(t).toContain('bcrypt')
    expect(t).toContain('compare')
  })

  it('returns [] for empty input', () => {
    expect(tokenize('')).toEqual([])
  })
})

describe('findRelevant', () => {
  const entries: MemoryEntry[] = [
    E({ keywords: ['auth', 'bcrypt'], body: 'login flow uses bcrypt comparisons' }),
    E({ keywords: ['lsp'], body: 'tsserver integration in Nuka' }),
    E({ keywords: ['ui', 'ink'], body: 'TUI built with Ink and React' }),
  ]

  it('ranks the most keyword-relevant entry first', () => {
    const out = findRelevant(entries, tokenize('please review the bcrypt login code'))
    expect(out.length).toBeGreaterThanOrEqual(1)
    expect(out[0]!.keywords).toContain('bcrypt')
  })

  it('returns [] when no token matches', () => {
    expect(findRelevant(entries, tokenize('completely orthogonal query'))).toEqual([])
  })

  it('returns [] for empty corpus or empty query', () => {
    expect(findRelevant([], tokenize('hi'))).toEqual([])
    expect(findRelevant(entries, [])).toEqual([])
  })

  it('caps results at K', () => {
    const big: MemoryEntry[] = Array.from({ length: 10 }, (_, i) =>
      E({ keywords: ['shared'], body: `entry ${i}` }),
    )
    const out = findRelevant(big, ['shared'], 3)
    expect(out).toHaveLength(3)
  })
})

// ── Synth via mock provider ──────────────────────────────────────────────────

function mockProvider(text: string, opts: { delayMs?: number; throwError?: boolean } = {}): LLMProvider {
  return {
    id: 'mock', format: 'openai',
    async *stream(): AsyncIterable<ProviderEvent> {
      if (opts.throwError) throw new Error('boom')
      if (opts.delayMs) await new Promise(r => setTimeout(r, opts.delayMs))
      // chunk to exercise the streaming path
      for (const piece of text.match(/.{1,20}/gs) ?? [text]) {
        yield { type: 'text_delta', text: piece }
      }
      yield { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } }
    },
    async listRemoteModels() { return [] },
  } as LLMProvider
}

describe('synthMemoryEntry', () => {
  const turns = [
    { role: 'user' as const, id: 'u1', ts: 0, content: [{ type: 'text' as const, text: 'help with auth' }] },
    { role: 'assistant' as const, id: 'a1', ts: 1, content: [{ type: 'text' as const, text: 'use bcrypt' }] },
  ]

  it('parses a well-formed YAML+body response', async () => {
    const text = '---\nkeywords: [auth, bcrypt]\nscore: 0.8\n---\n\nUser prefers bcrypt.compare for password checks.'
    const e = await synthMemoryEntry(turns, mockProvider(text), 'm', 'sess-1')
    expect(e).not.toBeNull()
    expect(e!.keywords).toEqual(['auth', 'bcrypt'])
    expect(e!.score).toBe(0.8)
    expect(e!.body).toContain('bcrypt.compare')
    expect(e!.sessionId).toBe('sess-1')
    expect(typeof e!.ts).toBe('string')
  })

  it('returns null on "NONE"', async () => {
    const e = await synthMemoryEntry(turns, mockProvider('NONE'), 'm', 'sess-1')
    expect(e).toBeNull()
  })

  it('returns null on garbage output', async () => {
    const e = await synthMemoryEntry(turns, mockProvider('this is not yaml'), 'm', 'sess-1')
    expect(e).toBeNull()
  })

  it('returns null when provider throws', async () => {
    const e = await synthMemoryEntry(turns, mockProvider('', { throwError: true }), 'm', 'sess-1')
    expect(e).toBeNull()
  })

  it('returns null when timeout fires', async () => {
    const text = '---\nkeywords: [x]\n---\n\nbody'
    const e = await synthMemoryEntry(
      turns,
      mockProvider(text, { delayMs: 200 }),
      'm',
      'sess-1',
      { timeoutMs: 25 },
    )
    expect(e).toBeNull()
  })

  it('returns null on empty turns array', async () => {
    const e = await synthMemoryEntry([], mockProvider('whatever'), 'm', 'sess-1')
    expect(e).toBeNull()
  })
})
