// test/core/agent/autoCompact.test.ts
//
// Coverage for the Iter TTT auto-compact orchestrator. The orchestrator is
// a pure function over `Message[]` + `AutoCompactConfig`; these tests pin
// down each branch of the decision tree without spinning up a provider,
// session, or real agent loop.
//
// Conventions:
//   - All fixtures use 1 char ≈ 4 tokens via the default byte-ratio. Tests
//     pick string lengths to land just above or below thresholds rather
//     than asserting exact token counts, so a change to the heuristic
//     doesn't bork the suite.
//   - HookRegistry uses the real `createHookRegistry()` — no mocks — so the
//     veto path exercises the same code the agent loop will.

import { describe, it, expect, vi } from 'vitest'
import { createHookRegistry } from '../../../src/core/hooks/registry'
import {
  maybeAutoCompact,
  DEFAULT_PRESERVE_RECENT,
} from '../../../src/core/agent/autoCompact'
import type {
  Message,
  UserMessage,
  AssistantMessage,
  SystemMessage,
  ToolMessage,
} from '../../../src/core/message/types'

let idCounter = 0
function nextId(): string {
  idCounter += 1
  return `m${idCounter}`
}

function user(text: string): UserMessage {
  return {
    role: 'user',
    id: nextId(),
    ts: idCounter,
    content: [{ type: 'text', text }],
  }
}

function assistant(text: string): AssistantMessage {
  return {
    role: 'assistant',
    id: nextId(),
    ts: idCounter,
    content: [{ type: 'text', text }],
  }
}

function system(text: string): SystemMessage {
  return { role: 'system', content: text }
}

function tool(output: string): ToolMessage {
  return {
    role: 'tool',
    toolUseId: nextId(),
    content: output,
    isError: false,
    id: nextId(),
    ts: idCounter,
  }
}

/** Generate a synthetic transcript with N user+assistant pairs each ~400 chars. */
function makeHeavyTranscript(pairs: number): Message[] {
  const out: Message[] = []
  for (let i = 0; i < pairs; i++) {
    out.push(user(`user-msg-${i}-${'x'.repeat(400)}`))
    out.push(assistant(`assistant-msg-${i}-${'y'.repeat(400)}`))
  }
  return out
}

describe('maybeAutoCompact — threshold gate', () => {
  it('returns compacted=false with reason "below-threshold" when tokens are under trigger', async () => {
    const messages: Message[] = [user('hi'), assistant('hello')]
    const result = await maybeAutoCompact(messages, {
      triggerTokens: 1000,
      targetTokens: 500,
    })
    expect(result.compacted).toBe(false)
    expect(result.reason).toBe('below-threshold')
    expect(result.before.messageCount).toBe(2)
    expect(result.after.messageCount).toBe(2)
    expect(result.messages).toHaveLength(2)
  })

  it('returns the same token count for before and after when below threshold', async () => {
    const messages: Message[] = [user('hi'), assistant('hello there')]
    const result = await maybeAutoCompact(messages, {
      triggerTokens: 1_000_000,
      targetTokens: 500_000,
    })
    expect(result.before.estimatedTokens).toBe(result.after.estimatedTokens)
  })

  it('returns a copy (not the same reference) even when not compacted', async () => {
    const messages: Message[] = [user('hi')]
    const result = await maybeAutoCompact(messages, {
      triggerTokens: 1_000_000,
      targetTokens: 500_000,
    })
    expect(result.messages).not.toBe(messages)
    expect(result.messages).toEqual(messages)
  })
})

describe('maybeAutoCompact — empty / trivial inputs', () => {
  it('returns compacted=false for an empty transcript', async () => {
    const result = await maybeAutoCompact([], {
      triggerTokens: 0,
      targetTokens: 0,
    })
    expect(result.compacted).toBe(false)
    expect(result.reason).toBe('below-threshold')
    expect(result.messages).toEqual([])
  })

  it('returns compacted=false for a single message even when over threshold', async () => {
    const lone = user('x'.repeat(2000))
    const result = await maybeAutoCompact([lone], {
      triggerTokens: 100,
      targetTokens: 50,
      preserveRecent: DEFAULT_PRESERVE_RECENT,
    })
    // Single message ends up entirely inside the preserved tail → nothing to fold.
    expect(result.compacted).toBe(false)
    expect(result.reason).toBe('nothing-to-compact')
  })
})

describe('maybeAutoCompact — compaction happy path', () => {
  it('reduces message count and tokens when over threshold', async () => {
    const messages = makeHeavyTranscript(10)
    const beforeCount = messages.length
    const result = await maybeAutoCompact(messages, {
      triggerTokens: 200,
      targetTokens: 100,
      preserveRecent: 2,
    })
    expect(result.compacted).toBe(true)
    expect(result.reason).toBeUndefined()
    expect(result.after.messageCount).toBeLessThan(beforeCount)
    expect(result.after.estimatedTokens).toBeLessThan(result.before.estimatedTokens)
  })

  it('does not mutate the input message array', async () => {
    const messages = makeHeavyTranscript(8)
    const snapshot = messages.slice()
    await maybeAutoCompact(messages, {
      triggerTokens: 200,
      targetTokens: 100,
    })
    expect(messages).toEqual(snapshot)
  })

  it('injects a placeholder summary when no summarizer is provided', async () => {
    const messages = makeHeavyTranscript(8)
    const result = await maybeAutoCompact(messages, {
      triggerTokens: 200,
      targetTokens: 100,
      preserveRecent: 2,
    })
    const summaries = result.messages.filter(
      (m): m is SystemMessage =>
        m.role === 'system' && m.content.startsWith('[Compacted'),
    )
    expect(summaries).toHaveLength(1)
    expect(summaries[0]!.content).toMatch(/\[Compacted \d+ messages, ~\d+ tokens\]/)
  })
})

describe('maybeAutoCompact — preserveRecent', () => {
  it('keeps the last N non-system messages verbatim', async () => {
    const messages = makeHeavyTranscript(8)
    const lastFour = messages.slice(-4)
    const result = await maybeAutoCompact(messages, {
      triggerTokens: 200,
      targetTokens: 50_000, // enormous, so no iterative pruning past initial fold
      preserveRecent: 4,
    })
    expect(result.compacted).toBe(true)
    // The last 4 messages should appear at the end of the result, unchanged.
    const tail = result.messages.slice(-4)
    expect(tail).toEqual(lastFour)
  })

  it('uses default preserveRecent when omitted', async () => {
    const messages = makeHeavyTranscript(8)
    const result = await maybeAutoCompact(messages, {
      triggerTokens: 200,
      targetTokens: 50_000,
    })
    expect(result.compacted).toBe(true)
    // 8 pairs = 16 messages. With default preserveRecent=6, the tail should
    // contain the original last 6 messages (in order).
    const expectedTail = messages.slice(-DEFAULT_PRESERVE_RECENT)
    expect(result.messages.slice(-DEFAULT_PRESERVE_RECENT)).toEqual(expectedTail)
  })

  it('falls back to nothing-to-compact when preserveRecent >= message count', async () => {
    const messages = makeHeavyTranscript(2)
    const result = await maybeAutoCompact(messages, {
      triggerTokens: 100,
      targetTokens: 50,
      preserveRecent: 10,
    })
    expect(result.compacted).toBe(false)
    expect(result.reason).toBe('nothing-to-compact')
  })
})

describe('maybeAutoCompact — system messages', () => {
  it('preserves system messages verbatim across compaction', async () => {
    const sys1 = system('YOU ARE A HELPFUL ASSISTANT')
    const sys2 = system('NEVER OUTPUT JSON')
    const middle = makeHeavyTranscript(8)
    const messages: Message[] = [sys1, sys2, ...middle]
    const result = await maybeAutoCompact(messages, {
      triggerTokens: 200,
      targetTokens: 50_000,
      preserveRecent: 2,
    })
    expect(result.compacted).toBe(true)
    expect(result.messages[0]).toBe(sys1)
    expect(result.messages[1]).toBe(sys2)
  })
})

describe('maybeAutoCompact — custom summarizer', () => {
  it('calls summarize with the dropped middle and uses its result', async () => {
    const messages = makeHeavyTranscript(8)
    const summarize = vi.fn().mockResolvedValue('PROVIDED SUMMARY')
    const result = await maybeAutoCompact(messages, {
      triggerTokens: 200,
      targetTokens: 50_000,
      preserveRecent: 2,
      summarize,
    })
    expect(summarize).toHaveBeenCalledOnce()
    // Argument should be the foldable middle: every message except the last 2.
    const summaryArg = summarize.mock.calls[0]![0] as Message[]
    expect(summaryArg).toHaveLength(messages.length - 2)
    // Synthetic system message should carry the provided text verbatim.
    const summaries = result.messages.filter(
      (m): m is SystemMessage => m.role === 'system',
    )
    expect(summaries.some((m) => m.content === 'PROVIDED SUMMARY')).toBe(true)
  })

  it('does not call summarize when below threshold', async () => {
    const summarize = vi.fn().mockResolvedValue('SHOULD NOT FIRE')
    await maybeAutoCompact([user('hi')], {
      triggerTokens: 1_000_000,
      targetTokens: 500_000,
      summarize,
    })
    expect(summarize).not.toHaveBeenCalled()
  })
})

describe('maybeAutoCompact — hook veto', () => {
  it('returns compacted=false with reason "vetoed-by-hook" when handler vetoes', async () => {
    const registry = createHookRegistry()
    registry.register('beforeAutoCompact', () => ({ skip: true }))
    const messages = makeHeavyTranscript(8)
    const result = await maybeAutoCompact(
      messages,
      { triggerTokens: 200, targetTokens: 100 },
      { hookRegistry: registry },
    )
    expect(result.compacted).toBe(false)
    expect(result.reason).toBe('vetoed-by-hook')
    // Original transcript returned unchanged.
    expect(result.messages).toEqual(messages)
  })

  it('compacts when handler does NOT veto', async () => {
    const registry = createHookRegistry()
    const seen: number[] = []
    registry.register('beforeAutoCompact', (ctx) => {
      const p = ctx.payload as { tokensBefore: number }
      seen.push(p.tokensBefore)
    })
    const messages = makeHeavyTranscript(8)
    const result = await maybeAutoCompact(
      messages,
      { triggerTokens: 200, targetTokens: 50_000, preserveRecent: 2 },
      { hookRegistry: registry },
    )
    expect(seen).toHaveLength(1)
    expect(seen[0]).toBeGreaterThan(200)
    expect(result.compacted).toBe(true)
  })

  it('does not fire the hook when below threshold', async () => {
    const registry = createHookRegistry()
    const handler = vi.fn(() => undefined)
    registry.register('beforeAutoCompact', handler)
    await maybeAutoCompact(
      [user('hi')],
      { triggerTokens: 1_000_000, targetTokens: 500_000 },
      { hookRegistry: registry },
    )
    expect(handler).not.toHaveBeenCalled()
  })
})

describe('maybeAutoCompact — iterative pruning', () => {
  it('keeps pruning the tail until under target', async () => {
    // 8 pairs of long messages. preserveRecent=6, so 10 messages go into
    // the middle and become a placeholder summary (~tens of tokens). The
    // remaining tail is still huge — iterative pruning should chip away.
    const messages = makeHeavyTranscript(8)
    const result = await maybeAutoCompact(messages, {
      triggerTokens: 200,
      targetTokens: 150, // tight target relative to ~400-char tail messages
      preserveRecent: 6,
    })
    expect(result.compacted).toBe(true)
    // We stop at tail.length === 1 if target is impossible; verify we got
    // closer than "no pruning happened".
    expect(result.after.estimatedTokens).toBeLessThan(result.before.estimatedTokens)
  })

  it('does not prune past a single tail message', async () => {
    const messages = makeHeavyTranscript(4)
    const result = await maybeAutoCompact(messages, {
      triggerTokens: 10,
      targetTokens: 1, // unreachable
      preserveRecent: 2,
    })
    expect(result.compacted).toBe(true)
    // Result must still contain at least one non-system message.
    const nonSystem = result.messages.filter((m) => m.role !== 'system')
    expect(nonSystem.length).toBeGreaterThanOrEqual(1)
  })
})

describe('maybeAutoCompact — abort signal', () => {
  it('treats a pre-aborted signal as a veto AFTER the threshold gate', async () => {
    const messages = makeHeavyTranscript(8)
    const ctrl = new AbortController()
    ctrl.abort()
    const result = await maybeAutoCompact(
      messages,
      { triggerTokens: 200, targetTokens: 100, preserveRecent: 2 },
      { signal: ctrl.signal },
    )
    // Without a hookRegistry the hook fire is skipped; the inline abort
    // check after the partition surfaces as a "vetoed-by-hook" reason.
    expect(result.compacted).toBe(false)
    expect(result.reason).toBe('vetoed-by-hook')
  })

  it('honours an abort that fires inside the summarizer', async () => {
    const messages = makeHeavyTranscript(8)
    const ctrl = new AbortController()
    const summarize = vi.fn().mockImplementation(async () => {
      ctrl.abort()
      return 'late-summary'
    })
    const result = await maybeAutoCompact(
      messages,
      {
        triggerTokens: 200,
        targetTokens: 100,
        preserveRecent: 2,
        summarize,
      },
      { signal: ctrl.signal },
    )
    expect(summarize).toHaveBeenCalledOnce()
    expect(result.compacted).toBe(false)
    expect(result.reason).toBe('vetoed-by-hook')
  })
})

describe('maybeAutoCompact — tool messages', () => {
  it('treats tool messages like other non-system messages', async () => {
    const messages: Message[] = [
      user('start'),
      assistant('calling tool'),
      tool('result-' + 'z'.repeat(400)),
      tool('result2-' + 'z'.repeat(400)),
      assistant('done'),
      user('next'),
      assistant('reply'),
      user('again'),
    ]
    const result = await maybeAutoCompact(messages, {
      triggerTokens: 100,
      targetTokens: 50_000,
      preserveRecent: 3,
    })
    expect(result.compacted).toBe(true)
    // The last 3 messages should still be present in order at the end.
    expect(result.messages.slice(-3)).toEqual(messages.slice(-3))
  })
})

// ─── compactSessionAware ───────────────────────────────────────────────────
import { compactSessionAware } from '../../../src/core/agent/autoCompact'
import type { Session } from '../../../src/core/session/types'
import { PermissionCache } from '../../../src/core/permission/cache'
import { MessageQueue } from '../../../src/core/session/queue'

function makeSession(messages: Message[]): Session {
  return {
    id: 'sess-1',
    providerId: 'p',
    model: 'm',
    messages,
    totalUsage: { inputTokens: 100_000, outputTokens: 50_000 },
    permissionCache: new PermissionCache(),
    queue: new MessageQueue(),
    mode: 'normal',
    createdAt: 1,
    updatedAt: 1,
    unDeferredToolNames: new Set(),
  }
}

describe('compactSessionAware', () => {
  it('returns compacted=false below threshold and leaves session untouched', async () => {
    const s = makeSession([
      { role: 'user', content: [{ type: 'text', text: 'short' }], id: 'm1' } as Message,
    ])
    s.totalUsage = { inputTokens: 10, outputTokens: 5 }
    const before = s.messages
    const out = await compactSessionAware(s, {
      autoThreshold: 0.8,
      contextWindow: 200_000,
    })
    expect(out.compacted).toBe(false)
    expect(s.messages).toBe(before)
    expect(s.updatedAt).toBe(1)  // unchanged
  })

  it('compacts and writes new messages + updatedAt when over threshold', async () => {
    const bigText = 'x'.repeat(20_000)
    const msgs: Message[] = []
    for (let i = 0; i < 30; i++) {
      msgs.push({ role: 'user', content: [{ type: 'text', text: bigText }], id: `u${i}` } as Message)
      msgs.push({ role: 'assistant', content: [{ type: 'text', text: bigText }], id: `a${i}` } as Message)
    }
    const s = makeSession(msgs)
    s.totalUsage = { inputTokens: 200_000, outputTokens: 100_000 }
    const before = s.messages
    const beforeUpdatedAt = s.updatedAt
    const out = await compactSessionAware(s, {
      autoThreshold: 0.5,
      contextWindow: 200_000,
      targetTokens: 20_000,
    })
    expect(out.compacted).toBe(true)
    expect(s.messages).not.toBe(before)
    expect(s.messages.length).toBeLessThan(before.length)
    expect(s.updatedAt).toBeGreaterThan(beforeUpdatedAt)
    // totalUsage is intentionally NOT zeroed — the next provider call's
    // inputTokens reflects the shorter prompt, mirroring legacy behaviour.
    expect(s.totalUsage.inputTokens).toBe(200_000)
  })

  it('preserves session metadata (id, providerId, mode, queue, permissionCache)', async () => {
    const msgs: Message[] = []
    const big = 'y'.repeat(10_000)
    for (let i = 0; i < 20; i++) {
      msgs.push({ role: 'user', content: [{ type: 'text', text: big }], id: `u${i}` } as Message)
    }
    const s = makeSession(msgs)
    s.totalUsage = { inputTokens: 150_000, outputTokens: 60_000 }
    const origQueue = s.queue
    const origCache = s.permissionCache
    await compactSessionAware(s, {
      autoThreshold: 0.5,
      contextWindow: 200_000,
      targetTokens: 10_000,
    })
    expect(s.id).toBe('sess-1')
    expect(s.providerId).toBe('p')
    expect(s.mode).toBe('normal')
    expect(s.queue).toBe(origQueue)
    expect(s.permissionCache).toBe(origCache)
  })
})
