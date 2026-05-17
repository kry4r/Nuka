// test/core/memdir/findRelevantMemories.test.ts
//
// Ported from upstream Nuka-Code in Issue #9. Covers:
//
//  - basic scan + selector picks a single memory whose description
//    matches the query (the happy path)
//  - empty corpus / aborted signal degrade to []
//  - `alreadySurfaced` filters out paths before the LLM call
//  - parseSelectedFilenames is defensive against fenced/prose output
//
// The LLM call is exercised via the same mockProvider pattern that
// relevance.test.ts already uses for synthMemoryEntry — synth and
// findRelevantMemories share the provider-injection contract.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  findRelevantMemories,
  parseSelectedFilenames,
} from '../../../src/core/memdir/findRelevantMemories'
import type {
  LLMProvider,
  ProviderEvent,
  LLMRequest,
} from '../../../src/core/provider/types'

// ── helpers ───────────────────────────────────────────────────

type MockOpts = { delayMs?: number; throwError?: boolean }

/**
 * Mock provider that yields a fixed text payload as a single chunk
 * `text_delta`, then a `message_stop`. Captures the most recent
 * `LLMRequest` so the test can assert that the manifest reached the
 * model — equivalent to relevance.test.ts's helper but exposes the
 * captured request.
 */
function makeProvider(payload: string, opts: MockOpts = {}): {
  provider: LLMProvider
  lastRequest: () => LLMRequest | null
} {
  let captured: LLMRequest | null = null
  const provider: LLMProvider = {
    id: 'mock',
    format: 'openai',
    async *stream(req): AsyncIterable<ProviderEvent> {
      captured = req
      if (opts.throwError) throw new Error('boom')
      if (opts.delayMs) await new Promise(r => setTimeout(r, opts.delayMs))
      yield { type: 'text_delta', text: payload }
      yield {
        type: 'message_stop',
        stopReason: 'end_turn',
        usage: { inputTokens: 0, outputTokens: 0 },
      }
    },
    async listRemoteModels() {
      return []
    },
  }
  return { provider, lastRequest: () => captured }
}

async function writeMd(dir: string, name: string, body: string): Promise<string> {
  const p = path.join(dir, name)
  await fs.writeFile(p, body, 'utf8')
  return p
}

let tmpRoot: string

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nuka-memdir-test-'))
})

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true })
})

// ── scan + select happy path ─────────────────────────────────

describe('findRelevantMemories: basic case', () => {
  it('returns the memory the selector named, with its absolute path + mtime', async () => {
    const authPath = await writeMd(
      tmpRoot,
      'auth.md',
      '---\ndescription: bcrypt-based login flow\ntype: project\n---\n\nbody about auth',
    )
    await writeMd(
      tmpRoot,
      'ui.md',
      '---\ndescription: Ink/React TUI conventions\ntype: reference\n---\n\nbody about ui',
    )
    // MEMORY.md is the entrypoint index — scanner must exclude it.
    await writeMd(tmpRoot, 'MEMORY.md', '- [Auth](auth.md) — login')

    const { provider, lastRequest } = makeProvider(
      '{"selected_memories":["auth.md"]}',
    )
    const ac = new AbortController()
    const out = await findRelevantMemories(
      'help me with bcrypt comparisons',
      tmpRoot,
      provider,
      'mock-model',
      ac.signal,
    )

    expect(out).toHaveLength(1)
    expect(out[0]!.path).toBe(authPath)
    expect(typeof out[0]!.mtimeMs).toBe('number')
    expect(out[0]!.mtimeMs).toBeGreaterThan(0)

    // The selector saw the manifest with both .md files but not MEMORY.md.
    const req = lastRequest()
    expect(req).not.toBeNull()
    const userText = (req!.messages[0]!.content[0] as { text: string }).text
    expect(userText).toContain('auth.md')
    expect(userText).toContain('ui.md')
    expect(userText).not.toContain('MEMORY.md')
    // [type] tag from manifest formatter survives the round-trip.
    expect(userText).toContain('[project] auth.md')
  })

  it('returns [] for an empty corpus without calling the provider', async () => {
    let called = false
    const provider: LLMProvider = {
      id: 'mock',
      format: 'openai',
      async *stream(): AsyncIterable<ProviderEvent> {
        called = true
        yield {
          type: 'message_stop',
          stopReason: 'end_turn',
          usage: { inputTokens: 0, outputTokens: 0 },
        }
      },
      async listRemoteModels() {
        return []
      },
    }
    const out = await findRelevantMemories(
      'anything',
      tmpRoot,
      provider,
      'm',
      new AbortController().signal,
    )
    expect(out).toEqual([])
    expect(called).toBe(false)
  })

  it('filters out paths in alreadySurfaced before the LLM call', async () => {
    const fresh = await writeMd(
      tmpRoot,
      'fresh.md',
      '---\ndescription: fresh memory\n---\nbody',
    )
    const stale = await writeMd(
      tmpRoot,
      'stale.md',
      '---\ndescription: already shown\n---\nbody',
    )
    const { provider, lastRequest } = makeProvider(
      '{"selected_memories":["fresh.md","stale.md"]}',
    )
    const out = await findRelevantMemories(
      'q',
      tmpRoot,
      provider,
      'm',
      new AbortController().signal,
      { alreadySurfaced: new Set([stale]) },
    )
    // Selector hallucinated `stale.md`, but the scanner had already
    // pruned it — only fresh.md is valid.
    expect(out).toHaveLength(1)
    expect(out[0]!.path).toBe(fresh)

    const userText = (
      lastRequest()!.messages[0]!.content[0] as { text: string }
    ).text
    expect(userText).toContain('fresh.md')
    expect(userText).not.toContain('stale.md')
  })

  it('returns [] when provider throws', async () => {
    await writeMd(tmpRoot, 'a.md', '---\ndescription: x\n---\nbody')
    const { provider } = makeProvider('', { throwError: true })
    const out = await findRelevantMemories(
      'q',
      tmpRoot,
      provider,
      'm',
      new AbortController().signal,
    )
    expect(out).toEqual([])
  })

  it('includes recentTools in the manifest payload', async () => {
    await writeMd(tmpRoot, 'a.md', '---\ndescription: x\n---\nbody')
    const { provider, lastRequest } = makeProvider(
      '{"selected_memories":[]}',
    )
    await findRelevantMemories(
      'q',
      tmpRoot,
      provider,
      'm',
      new AbortController().signal,
      { recentTools: ['MyTool', 'Other'] },
    )
    const userText = (
      lastRequest()!.messages[0]!.content[0] as { text: string }
    ).text
    expect(userText).toContain('Recently used tools: MyTool, Other')
  })
})

// ── parseSelectedFilenames defensive parsing ─────────────────

describe('parseSelectedFilenames', () => {
  const valid = new Set(['a.md', 'b.md', 'c.md'])

  it('parses well-formed JSON', () => {
    expect(parseSelectedFilenames('{"selected_memories":["a.md","b.md"]}', valid))
      .toEqual(['a.md', 'b.md'])
  })

  it('strips a leading markdown code fence', () => {
    const wrapped = '```json\n{"selected_memories":["a.md"]}\n```'
    expect(parseSelectedFilenames(wrapped, valid)).toEqual(['a.md'])
  })

  it('recovers when the model surrounds JSON with prose', () => {
    const prosed = 'Sure! Here you go: {"selected_memories":["c.md"]} done.'
    expect(parseSelectedFilenames(prosed, valid)).toEqual(['c.md'])
  })

  it('filters out filenames the scan did not produce', () => {
    expect(
      parseSelectedFilenames('{"selected_memories":["a.md","ghost.md"]}', valid),
    ).toEqual(['a.md'])
  })

  it('caps results at 5', () => {
    const six = '{"selected_memories":["a.md","a.md","a.md","a.md","a.md","a.md"]}'
    expect(parseSelectedFilenames(six, valid).length).toBeLessThanOrEqual(5)
  })

  it('returns [] for empty / malformed input', () => {
    expect(parseSelectedFilenames('', valid)).toEqual([])
    expect(parseSelectedFilenames('not json at all', valid)).toEqual([])
    expect(parseSelectedFilenames('{"wrong_key": ["a.md"]}', valid)).toEqual([])
  })
})
