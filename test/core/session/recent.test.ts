// test/core/session/recent.test.ts
import { describe, it, expect } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { loadRecent, MAX_RECENT, PREVIEW_LEN } from '../../../src/core/session/recent'

async function withTmp(fn: (home: string) => Promise<void>): Promise<void> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'nuka-recent-test-'))
  try {
    await fn(home)
  } finally {
    await fs.rm(home, { recursive: true, force: true })
  }
}

/**
 * Write a minimal session into home/.nuka/sessions/
 * Returns the sessionId.
 */
async function writeSession(
  home: string,
  sessionId: string,
  updatedAt: number,
  firstUserText: string | null,
): Promise<void> {
  const sessDir = path.join(home, '.nuka', 'sessions')
  await fs.mkdir(sessDir, { recursive: true })

  // Write meta
  const meta = {
    id: sessionId,
    providerId: 'anthropic',
    model: 'claude-3',
    messageCount: firstUserText ? 1 : 0,
    totalUsage: { inputTokens: 0, outputTokens: 0 },
    mode: 'normal',
    createdAt: updatedAt - 1000,
    updatedAt,
  }
  await fs.writeFile(
    path.join(sessDir, `${sessionId}.meta.json`),
    JSON.stringify(meta),
    'utf8',
  )

  // Write messages (JSONL)
  if (firstUserText !== null) {
    const userMsg = {
      role: 'user',
      content: [{ type: 'text', text: firstUserText }],
      id: `msg-${sessionId}`,
      ts: updatedAt - 500,
    }
    await fs.writeFile(
      path.join(sessDir, `${sessionId}.jsonl`),
      JSON.stringify(userMsg) + '\n',
      'utf8',
    )
  }
}

describe('loadRecent', () => {
  it('returns [] when sessions dir does not exist', async () => {
    await withTmp(async home => {
      const result = await loadRecent(home)
      expect(result).toEqual([])
    })
  })

  it('returns entries for sessions that have user messages', async () => {
    await withTmp(async home => {
      await writeSession(home, 'sess-1', Date.now(), 'Fix the login bug')
      const result = await loadRecent(home)
      expect(result).toHaveLength(1)
      expect(result[0]?.id).toBe('sess-1')
      expect(result[0]?.preview).toBe('Fix the login bug')
    })
  })

  it('skips sessions with no user messages', async () => {
    await withTmp(async home => {
      await writeSession(home, 'sess-empty', Date.now(), null)
      const result = await loadRecent(home)
      expect(result).toEqual([])
    })
  })

  it(`truncates preview to ${PREVIEW_LEN} chars with ellipsis`, async () => {
    await withTmp(async home => {
      const long = 'a'.repeat(PREVIEW_LEN + 20)
      await writeSession(home, 'sess-long', Date.now(), long)
      const result = await loadRecent(home)
      const preview = result[0]?.preview ?? ''
      expect(preview.length).toBe(PREVIEW_LEN)
      expect(preview.endsWith('\u2026')).toBe(true)
    })
  })

  it('returns newest sessions first', async () => {
    await withTmp(async home => {
      const now = Date.now()
      await writeSession(home, 'sess-old', now - 5000, 'older message')
      await writeSession(home, 'sess-new', now, 'newer message')
      const result = await loadRecent(home)
      expect(result[0]?.id).toBe('sess-new')
      expect(result[1]?.id).toBe('sess-old')
    })
  })

  it(`caps at ${MAX_RECENT} entries`, async () => {
    await withTmp(async home => {
      const now = Date.now()
      for (let i = 0; i < MAX_RECENT + 3; i++) {
        await writeSession(home, `sess-${i}`, now + i, `message ${i}`)
      }
      const result = await loadRecent(home)
      expect(result).toHaveLength(MAX_RECENT)
    })
  })

  it('skips sessions with malformed messages file', async () => {
    await withTmp(async home => {
      const sessDir = path.join(home, '.nuka', 'sessions')
      await fs.mkdir(sessDir, { recursive: true })
      const sid = 'sess-bad'
      const meta = {
        id: sid, providerId: '', model: '', messageCount: 1,
        totalUsage: { inputTokens: 0, outputTokens: 0 },
        mode: 'normal', createdAt: Date.now(), updatedAt: Date.now(),
      }
      await fs.writeFile(path.join(sessDir, `${sid}.meta.json`), JSON.stringify(meta), 'utf8')
      await fs.writeFile(path.join(sessDir, `${sid}.jsonl`), '{bad json\n', 'utf8')
      // malformed JSONL → no valid user message → skipped
      const result = await loadRecent(home)
      expect(result).toEqual([])
    })
  })
})
